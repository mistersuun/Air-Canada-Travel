declare module 'globe.gl' {
  interface GlobeInstance {
    (element: HTMLElement): GlobeInstance;
    [method: string]: any;
  }
  function Globe(opts?: Record<string, any>): GlobeInstance;
  export default Globe;
}
