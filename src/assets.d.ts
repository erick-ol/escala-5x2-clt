/** Import `?url` do Vite: devolve o endereço do arquivo depois do build. */
declare module '*?url' {
  const url: string;
  export default url;
}
