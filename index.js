const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');

admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_KEY)),
  databaseURL: process.env.DB_URL
});

const ADMINS = ['sibemcesar@gmail.com', 'portaldigitalao@gmail.com'];

const app = express();
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => res.send('ok'));

app.post('/notificar', async (req, res) => {
  try {
    const idToken = (req.headers.authorization || '').replace('Bearer ', '');
    const user = await admin.auth().verifyIdToken(idToken);
    if (!ADMINS.includes(user.email)) return res.status(403).send('proibido');

    const { titulo, corpo, link, alvoUid } = req.body;
    if (!titulo || !corpo) return res.status(400).send('faltam dados');

    const entradas = [];
    if (alvoUid) {
      if (typeof alvoUid !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(alvoUid)) {
        return res.status(400).send('uid invalido');
      }
      const s = await admin.database().ref('fcmTokens/' + alvoUid).get();
      const v = s.val();
      if (v && v.token) entradas.push({ uid: alvoUid, token: v.token });
    } else {
      const snap = await admin.database().ref('fcmTokens').get();
      snap.forEach(u => {
        const v = u.val();
        if (v && v.token) entradas.push({ uid: u.key, token: v.token });
      });
    }

    let enviados = 0;
    for (let i = 0; i < entradas.length; i += 500) {
      const lote = entradas.slice(i, i + 500);
      const msg = {
        tokens: lote.map(e => e.token),
        notification: { title: titulo, body: corpo },
        webpush: { notification: { icon: 'https://portaldigital.vercel.app/logo.png' } }
      };
      if (link && /^https:\/\//.test(link)) {
        msg.webpush.fcmOptions = { link };
      }
      const r = await admin.messaging().sendEachForMulticast(msg);
      enviados += r.successCount;
      r.responses.forEach((x, idx) => {
        const c = x.error && x.error.code;
        if (c === 'messaging/registration-token-not-registered' ||
            c === 'messaging/invalid-registration-token') {
          admin.database().ref('fcmTokens/' + lote[idx].uid).remove();
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
