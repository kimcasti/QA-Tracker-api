import type { StrapiApp } from "@strapi/strapi/admin";
import { darkTheme, extendTheme, lightTheme } from "@strapi/design-system";
import logo from "./extensions/logo.png";

const qaTrackerLightTheme = extendTheme(lightTheme, {
  colors: {
    primary100: "#E8F8FC",
    primary200: "#C8EEF6",
    primary500: "#17B6D3",
    primary600: "#123F68",
    primary700: "#0F3558",
    secondary100: "#EEF5FB",
    secondary200: "#DCE8F8",
    secondary500: "#5D748B",
    secondary600: "#195687",
    secondary700: "#123F68",
    buttonPrimary500: "#17B6D3",
    buttonPrimary600: "#123F68",
    neutral0: "#FFFFFF",
    neutral100: "#F5F9FC",
    neutral150: "#EDF3F8",
    neutral200: "#D9E5EF",
    neutral300: "#C3D4E3",
    neutral600: "#5D748B",
    neutral700: "#39516A",
    neutral800: "#17324D",
    neutral900: "#102A43",
    neutral1000: "#081C2D",
  },
  shadows: {
    focus:
      "inset 2px 0px 0px rgb(18, 63, 104), inset 0px 2px 0px rgb(18, 63, 104), inset -2px 0px 0px rgb(18, 63, 104), inset 0px -2px 0px rgb(18, 63, 104)",
    focusShadow: "0px 0px 0px 3px rgba(23, 182, 211, 0.28)",
    popupShadow: "0px 20px 48px rgba(16, 42, 67, 0.14)",
    tableShadow: "0px 14px 36px rgba(16, 42, 67, 0.08)",
  },
});

const qaTrackerDarkTheme = extendTheme(darkTheme, {
  colors: {
    primary500: "#17B6D3",
    primary600: "#17B6D3",
    primary700: "#8AE0EF",
    secondary500: "#66B7F1",
    secondary600: "#17B6D3",
    secondary700: "#C8EEF6",
    buttonPrimary500: "#17B6D3",
    buttonPrimary600: "#123F68",
  },
});

export default {
  config: {
    auth: {
      logo: logo,
    },
    menu: {
      logo: logo,
    },
    locales: ["es"],
    notifications: {
      releases: false,
    },
    theme: {
      light: qaTrackerLightTheme,
      dark: qaTrackerDarkTheme,
    },
    translations: {
      es: {
        "Auth.form.button.login.strapi": "Iniciar sesión en QA Tracker",
        "Auth.form.welcome.subtitle":
          "Inicia sesión para administrar el backend de QA Tracker.",
        "Auth.form.welcome.title": "Bienvenida a QA Tracker",
        "HomePage.header.subtitle":
          "Administra modelos, contenido y permisos de tu plataforma QA.",
        "HomePage.welcome.congrats.content":
          "Ya tienes acceso al panel administrativo de QA Tracker. Desde aquí puedes gestionar modelos, datos y configuraciones del backend.",
        "Settings.application.description":
          "Configuración global del panel administrativo de QA Tracker.",
        "Settings.application.title": "Resumen de QA Tracker",
        "global.home": "Inicio",
        "global.settings": "Configuración",
      },
    },
    tutorials: false,
  },
  bootstrap(_app: StrapiApp) {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("strapi-admin-language", "es");

      if (!window.localStorage.getItem("STRAPI_THEME")) {
        window.localStorage.setItem("STRAPI_THEME", "light");
      }
    }
  },
};
