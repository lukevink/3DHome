import { defineConfig } from "vite";

export default defineConfig({
  build: {
    lib: {
      entry: "src/3dhomecard.ts",
      formats: ["es"],
      fileName: () => "3dhome.js"
    },
    rollupOptions: {
      output: {
        assetFileNames: "3dhome.[ext]"
      }
    },
    sourcemap: false,
    target: "es2022"
  }
});
