import type { StrapiApp } from '@strapi/strapi/admin';

export default {
  config: {
    locales: ['es'],
    notifications: {
      releases: false,
    },
    translations: {
      es: {
        'Auth.form.button.login.strapi': 'Iniciar sesion en QA Tracker',
        'Auth.form.welcome.subtitle':
          'Inicia sesion para administrar el backend de QA Tracker.',
        'Auth.form.welcome.title': 'Bienvenida a QA Tracker',
        'HomePage.header.subtitle':
          'Administra modelos, contenido y permisos de tu plataforma QA.',
        'HomePage.welcome.congrats.content':
          'Ya tienes acceso al panel administrativo de QA Tracker. Desde aqui puedes gestionar modelos, datos y configuraciones del backend.',
        'Settings.application.description':
          'Configuracion global del panel administrativo de QA Tracker.',
        'Settings.application.title': 'Resumen de QA Tracker',
        'global.home': 'Inicio',
        'global.settings': 'Configuracion',
      },
    },
    tutorials: false,
  },
  bootstrap(_app: StrapiApp) {},
};
