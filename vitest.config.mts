import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    include: [
      'tests/**/*.{test.ts,test.tsx,spec.ts,spec.tsx}',
      'src/**/*.{test.ts,test.tsx,spec.ts,spec.tsx}',
    ],
    css: true,
    typecheck: {
      tsconfig: './tsconfig.json',
    },
    coverage: {
      reporter: ['text', 'lcov'],
      reportsDirectory: './coverage',
    },
  },
})
