const helmet = require('helmet');
const morgan = require('morgan');
const csrf = require('csurf');
const express = require('express');
const cookieParser = require('cookie-parser');

function baseMiddleware(app) {
  app.use(helmet({
    contentSecurityPolicy: false,
  }));
  app.use(cookieParser());
  app.use(express.urlencoded({ extended: true, limit: '10mb' })); // Increased for image support
  app.use(express.json({ limit: '10mb' })); // Increased for image support
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


