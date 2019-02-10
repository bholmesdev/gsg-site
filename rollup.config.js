import svelte from 'rollup-plugin-svelte'
import resolve from 'rollup-plugin-node-resolve'

export default {
  input: 'main.js',
  output: {
    file: 'public/build/bundle.js',
    name: 'App',
    format: 'iife',
  },
  plugins: [
    resolve(),
    svelte({
      css: stylesheet => {
        stylesheet.write('public/build/bundle.css')
      },
    }),
  ],
}
