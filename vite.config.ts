import { defineConfig } from "vite";
import { voidPlugin } from "void";
import { voidVue } from "@void/vue/plugin";

export default defineConfig({
  plugins: [voidPlugin(), voidVue()],
  // Tidpunkten då appen byggdes. void deploy bygger alltid först, så det blir deploytiden.
  // Sparas i process.env så att klient- och serverbygget får samma tid.
  define: {
    __BUILD_TIME__: JSON.stringify((process.env.BUILD_TIME ??= new Date().toISOString())),
  },
});
