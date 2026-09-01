// tests/message.test.js

process.env.NODE_ENV = 'test';

const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const app = require('../app');
const User = require('../models/user.model');
const Message = require('../models/message.model');

let mongoServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { dbName: 'test' });
});

afterEach(async () => {
  await User.deleteMany();
  await Message.deleteMany();
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
  await mongoServer.stop();
});

// Crée un expéditeur et un destinataire, et renvoie le cookie de session de
// l'expéditeur (déjà connecté via l'inscription) ainsi que l'id du destinataire,
// pour pouvoir tester les routes protégées comme un vrai utilisateur connecté
const createSenderAndReceiver = async () => {
  const senderRes = await request(app).post('/api/auth/signup').send({
    username: 'sender',
    email: 'sender@example.com',
    password: 'password123',
  });
  const senderCookie = senderRes.headers['set-cookie'];

  const receiverRes = await request(app).post('/api/auth/signup').send({
    username: 'receiver',
    email: 'receiver@example.com',
    password: 'password123',
  });

  return { senderCookie, receiverId: receiverRes.body._id };
};

describe('POST /api/messages/send/:id', () => {
  it('refuse une requête sans authentification', async () => {
    const res = await request(app)
      .post('/api/messages/send/507f1f77bcf86cd799439011')
      .send({ text: 'Salut' });

    expect(res.statusCode).toBe(401);
  });

  it('envoie un message texte valide', async () => {
    const { senderCookie, receiverId } = await createSenderAndReceiver();

    const res = await request(app)
      .post(`/api/messages/send/${receiverId}`)
      .set('Cookie', senderCookie)
      .send({ text: 'Salut, ça va ?' });

    expect(res.statusCode).toBe(201);
    expect(res.body.text).toBe('Salut, ça va ?');
    expect(res.body.pendingApproval).toBe(false);
  });

  it('refuse un message vide (ni texte, ni pièce jointe)', async () => {
    const { senderCookie, receiverId } = await createSenderAndReceiver();

    const res = await request(app)
      .post(`/api/messages/send/${receiverId}`)
      .set('Cookie', senderCookie)
      .send({ text: '' });

    expect(res.statusCode).toBe(400);
  });

  it('refuse un texte trop long (plus de 2000 caractères)', async () => {
    const { senderCookie, receiverId } = await createSenderAndReceiver();

    const res = await request(app)
      .post(`/api/messages/send/${receiverId}`)
      .set('Cookie', senderCookie)
      .send({ text: 'a'.repeat(2001) });

    expect(res.statusCode).toBe(400);
  });

  it('refuse un identifiant de destinataire invalide', async () => {
    const { senderCookie } = await createSenderAndReceiver();

    const res = await request(app)
      .post('/api/messages/send/pas-un-id-valide')
      .set('Cookie', senderCookie)
      .send({ text: 'Salut' });

    expect(res.statusCode).toBe(400);
  });
});
