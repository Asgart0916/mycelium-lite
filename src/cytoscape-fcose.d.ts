// cytoscape-fcose 未附型別；只需要它能被 cytoscape.use() 註冊，故宣告成 unknown extension。
declare module "cytoscape-fcose" {
  const fcose: unknown;
  export default fcose;
}
