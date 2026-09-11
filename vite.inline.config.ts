import { defineConfig, mergeConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

import baseConfig from './vite.config.ts';

export default mergeConfig(
  baseConfig,
  defineConfig({
    plugins: [viteSingleFile()],
    build: {
      cssCodeSplit: false,
      assetsInlineLimit: 100_000_000,
    },
  }),
);
