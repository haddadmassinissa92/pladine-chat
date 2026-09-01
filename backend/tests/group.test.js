// tests/group.test.js

process.env.NODE_ENV = 'test';

const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const app = require('../app');
const User = require('../models/user.model');
const Group = require('../models/group.model');

let mongoServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { dbName: 'test' });
});

afterEach(async () => {
  await User.deleteMany();
  await Group.deleteMany();
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
  await mongoServer.stop();
});

// Crée un créateur (connecté) et un second utilisateur à inviter comme membre,
// et renvoie le cookie de session du créateur ainsi que l'id du second utilisateur
const createOwnerAndMember = async () => {
  const ownerRes = await request(app).post('/api/auth/signup').send({
    username: 'owner',
    email: 'owner@example.com',
    password: 'password123',
  });
  const ownerCookie = ownerRes.headers['set-cookie'];

  const memberRes = await request(app).post('/api/auth/signup').send({
    username: 'member',
    email: 'member@example.com',
    password: 'password123',
  });

  return { ownerCookie, memberId: memberRes.body._id };
};

describe('POST /api/groups', () => {
  it('refuse une requête sans authentification', async () => {
    const res = await request(app)
      .post('/api/groups')
      .send({ name: 'Mon groupe', members: [] });

    expect(res.statusCode).toBe(401);
  });

  it('crée un groupe avec un nom et des membres valides', async () => {
    const { ownerCookie, memberId } = await createOwnerAndMember();

    const res = await request(app)
      .post('/api/groups')
      .set('Cookie', ownerCookie)
      .send({ name: 'Les développeurs', members: [memberId] });

    expect(res.statusCode).toBe(201);
    expect(res.body.name).toBe('Les développeurs');
    // Le créateur doit automatiquement faire partie des membres, en plus
    // de la personne explicitement invitée
    expect(res.body.members.length).toBe(2);
  });

  it('refuse un nom de groupe vide', async () => {
    const { ownerCookie, memberId } = await createOwnerAndMember();

    const res = await request(app)
      .post('/api/groups')
      .set('Cookie', ownerCookie)
      .send({ name: '', members: [memberId] });

    expect(res.statusCode).toBe(400);
  });

  it('refuse un nom de groupe trop long (plus de 50 caractères)', async () => {
    const { ownerCookie, memberId } = await createOwnerAndMember();

    const res = await request(app)
      .post('/api/groups')
      .set('Cookie', ownerCookie)
      .send({ name: 'a'.repeat(51), members: [memberId] });

    expect(res.statusCode).toBe(400);
  });

  it('refuse un identifiant de membre invalide dans la liste', async () => {
    const { ownerCookie } = await createOwnerAndMember();

    const res = await request(app)
      .post('/api/groups')
      .set('Cookie', ownerCookie)
      .send({ name: 'Groupe test', members: ['pas-un-id-valide'] });

    expect(res.statusCode).toBe(400);
  });
});
