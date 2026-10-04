'use strict';

const express = require('express');
const { validateRegistration, validateCredentials } = require('../utils/validation');

function authRouter({ userService }) {
  const router = express.Router();

  router.post('/register', async (req, res) => {
    const user = await userService.register(validateRegistration(req.body));
    res.status(201).json(user);
  });

  router.post('/login', async (req, res) => {
    res.json(await userService.login(validateCredentials(req.body)));
  });

  return router;
}

module.exports = { authRouter };
