import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts', 'src/ag-ui/index.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  external: [
    '@api2aux/semantic-analysis',
    '@api2aux/tool-definition-builder',
    '@api2aux/workflow-inference',
  ],
})
