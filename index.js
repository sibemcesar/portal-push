const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');

admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_KEY)),
  databaseURL: process.env.DB_URL
});

const ADMINS = ['sibemcesar@gmail.com', 'portaldigitalao@gmail.com'];

// Tipos de conteúdo: o usuário pode desligar cada um nas preferências.
const TIPOS = ['jogos', 'aplicativos', 'tutoriais', 'pc', 'outros'];

// Validade padrão (em horas) quando o pedido não indica nenhuma.
const VALIDADE_CONTEUDO_H = 12;
const VALIDADE_OUTROS_H = 48;

const app = express();
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => res.send('ok'));

function textoCurto(v, max) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

function urlHttps(v) {
  const s = textoCurto(v, 1000);
  return /^https:\/\//.test(s) ? s : '';
}

app.post('/notificar', async (req, res) => {
  try {
    const idToken = (req.headers.authorization || '').replace('Bearer ', '');
    const user = await admin.auth().verifyIdToken(idToken);
    if (!ADMINS.includes(user.email)) return res.status(403).send('proibido');

    const body = req.body || {};
    const titulo = textoCurto(body.titulo, 100);
    const corpo = textoCurto(body.corpo, 300);
    const alvoUid = body.alvoUid;
    if (!titulo || !corpo) return res.status(400).send('faltam dados');

    const link = urlHttps(body.link);
    const imagem = urlHttps(body.imagem);
    const tipo = TIPOS.includes(body.tipo) ? body.tipo : '';
    const tag = /^[A-Za-z0-9_-]{1,64}$/.test(body.tag || '') ? body.tag : (tipo ? 'novo-conteudo' : 'geral');

    let validadeH = Number(body.validadeHoras);
    if (!isFinite(validadeH) || validadeH <= 0) {
      validadeH = tipo ? VALIDADE_CONTEUDO_H : VALIDADE_OUTROS_H;
    }
    validadeH = Math.min(Math.max(validadeH, 1), 168);
    const ttlSeg = Math.round(validadeH * 3600);

    const entradas = [];
    if (alvoUid) {
      if (typeof alvoUid !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(alvoUid)) {
        return res.status(400).send('uid invalido');
      }
      // Aviso individual (ex.: pontos recebidos) ignora as preferências por tipo.
      const s = await admin.database().ref('fcmTokens/' + alvoUid).get();
      const v = s.val();
      if (v && v.token) entradas.push({ uid: alvoUid, token: v.token });
    } else {
      const snap = await admin.database().ref('fcmTokens').get();
      snap.forEach(u => {
        const v = u.val();
        if (!v || !v.token) return;
        // Respeita a escolha do usuário: só salta se ele desligou explicitamente este tipo.
        if (tipo && v.prefs && v.prefs[tipo] === false) return;
        entradas.push({ uid: u.key, token: v.token });
      });
    }

    // Mensagem só de dados: o service worker monta a notificação (imagem, botões, agrupar).
    const data = {
      titulo,
      corpo,
      tag,
      tipo,
      link,
      imagem,
      acoes: tipo ? '1' : '0',
      expira: String(Date.now() + ttlSeg * 1000)
    };

    let enviados = 0;
    for (let i = 0; i < entradas.length; i += 500) {
      const lote = entradas.slice(i, i + 500);
      const msg = {
        tokens: lote.map(e => e.token),
        data,
        webpush: {
          headers: { TTL: String(ttlSeg), Urgency: 'normal' }
        }
      };
      const r = await admin.messaging().sendEachForMulticast(msg);
      enviados += r.successCount;
      r.responses.forEach((x, idx) => {
        const c = x.error && x.error.code;
        if (c === 'messaging/registration-token-not-registered' ||
            c === 'messaging/invalid-registration-token') {
          // Remove só o token inválido e mantém as preferências do usuário.
          admin.database().ref('fcmTokens/' + lote[idx].uid + '/token').remove();
        }
      });
    }
    res.json({ enviados });
  } catch (e) {
    console.error(e);
    res.status(500).send('erro');
  }
});

app.listen(process.env.PORT || 3000);
