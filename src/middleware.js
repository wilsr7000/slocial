const helmet = require('helmet');
const morgan = require('morgan');
const csrf = require('csurf');
const express = require('express');

function baseMiddleware(app) {
  app.use(helmet({
    contentSecurityPolicy: false,
  }));
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  app.use(morgan('dev'));
  app.use('/static', express.static('src/public'));
}

function csrfProtection() {
  return csrf();
}

module.exports = {
  baseMiddleware,
  csrfProtection,
};


