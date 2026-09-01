// tests/auth.test.js

// On force le mode test AVANT d'importer l'app, pour que app.js n'essaie
// pas de se connecter à la vraie base de données, et que les limiteurs de
// tentatives (rate limiting) soient désactivés sur les routes concernées
process.env.NODE_ENV = 'test';

const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const app = require('../app');
const User = require('../models/user.model');

let mongoServer;

// Avant tous les tests : démarre une base MongoDB temporaire en mémoire,
// et connecte Mongoose dessus (jamais la vraie base de production)
beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { dbName: 'test' });
});

// Après chaque test : on vide la collection des utilisateurs, pour que
// chaque test parte d'un état propre sans dépendre des tests précédents
afterEach(async () => {
  await User.deleteMany();
});

// Après tous les tests : ferme la connexion et arrête le serveur en mémoire
afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
  await mongoServer.stop();
});

describe('POST /api/auth/signup', () => {
  it('crée un compte avec des données valides', async () => {
    const res = await request(app).post('/api/auth/signup').send({
      username: 'testuser',
      email: 'test@example.com',
      password: 'password123',
    });

    expect(res.statusCode).toBe(201);
    expect(res.body.username).toBe('testuser');
    expect(res.body.email).toBe('test@example.com');
    // Le mot de passe (même haché) ne doit jamais être renvoyé au client
    expect(res.body.password).toBeUndefined();
  });

  it("refuse un nom d'utilisateur trop court", async () => {
    const res = await request(app).post('/api/auth/signup').send({
      username: 'ab',
      email: 'test2@example.com',
      password: 'password123',
    });

    expect(res.statusCode).toBe(400);
  });

  it('refuse un email au format invalide', async () => {
    const res = await request(app).post('/api/auth/signup').send({
      username: 'validuser',
      email: 'pas-un-email',
      password: 'password123',
    });

    expect(res.statusCode).toBe(400);
  });

  it('refuse un mot de passe trop court', async () => {
    const res = await request(app).post('/api/auth/signup').send({
      username: 'validuser2',
      email: 'test3@example.com',
      password: '123',
    });

    expect(res.statusCode).toBe(400);
  });

  it('refuse un email déjà utilisé par un autre compte', async () => {
    await request(app).post('/api/auth/signup').send({
      username: 'premierCompte',
      email: 'doublon@example.com',
      password: 'password123',
    });

    const res = await request(app).post('/api/auth/signup').send({
      username: 'deuxiemeCompte',
      email: 'doublon@example.com',
      password: 'password123',
    });

    expect(res.statusCode).toBe(400);
  });
});

describe('POST /api/auth/login', () => {
  // Avant chaque test de connexion, on crée un compte de référence à utiliser
  beforeEach(async () => {
    await request(app).post('/api/auth/signup').send({
      username: 'loginuser',
      email: 'login@example.com',
      password: 'password123',
    });
  });

  it('connecte avec les bons identifiants et pose un cookie de session', async () => {
    const res = await request(app).post('/api/auth/login').send({
      email: 'login@example.com',
      password: 'password123',
    });

    expect(res.statusCode).toBe(200);
    expect(res.body.username).toBe('loginuser');
    expect(res.headers['set-cookie']).toBeDefined();
  });

  it('refuse un mot de passe incorrect', async () => {
    const res = await request(app).post('/api/auth/login').send({
      email: 'login@example.com',
      password: 'mauvaisMotDePasse',
    });

    expect(res.statusCode).toBe(400);
  });

  it('refuse un email qui ne correspond à aucun compte', async () => {
    const res = await request(app).post('/api/auth/login').send({
      email: 'inconnu@example.com',
      password: 'password123',
    });

    expect(res.statusCode).toBe(400);
  });
});
