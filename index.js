const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');

admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_KEY)),
  databaseURL: process.env.DB_URL
});

const app = express();
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => res.send('ok'));

app.post('/notificar', async (req, res) => {
  try {
    const idToken = (req.headers.authorization || '').replace('Bearer ', '');
    const user = await admin.auth().verifyIdToken(idToken);

    // AJUSTA: onde guardas se o usuário é admin
    const role = await admin.database().ref('users/' + user.uid + '/role').get();
    if (role.val() !== 'admin') return res.status(403).send('proibido');

    const { titulo, corpo } = req.body;
    const snap = await admin.database().ref('users').get();
    const tokens = [];
    snap.forEach(u => {
      const t = u.child('fcmTokens').val();
      if (t) tokens.push(...Object.keys(t));
    });

    for (let i = 0; i < tokens.length; i += 500) {
      await admin.messaging().sendEachForMulticast({
        tokens: tokens.slice(i, i + 500),
        notification: { title: titulo, body: corpo }
      });
    }
    res.json({ enviados: tokens.length });
  } catch (e) {
    console.error(e);
    res.status(500).send('erro');
  }
});

app.listen(process.env.PORT || 3000);