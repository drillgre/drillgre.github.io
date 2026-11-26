(() => {
  "use strict";
  const delimiters = [
    {left:"\\(",right:"\\)",display:false},
    {left:"\\[",right:"\\]",display:true},
    {left:"$$",right:"$$",display:true}
  ];
  const config = {
    delimiters,
    throwOnError:false,
    strict:"ignore",
    trust:false,
    ignoredTags:["script","noscript","style","textarea","pre","code","option"],
    ignoredClasses:["katex","no-math-render"]
  };
  function render(root) {
    if (!root || !window.renderMathInElement) return;
    if (root.nodeType === 1 && root.closest && root.closest(".katex")) return;
    try { window.renderMathInElement(root,config); }
    catch (error) { console.warn("DrillGRE math rendering skipped:",error); }
  }
  function start() {
    render(document.body);
    const observer = new MutationObserver(records => {
      const added = new Set();
      records.forEach(record => record.addedNodes.forEach(node => {
        if (node.nodeType === 1 && !node.classList.contains("katex")) added.add(node);
        else if (node.nodeType === 3 && node.parentElement && !node.parentElement.closest(".katex")) added.add(node.parentElement);
      }));
      added.forEach(render);
    });
    observer.observe(document.body,{childList:true,subtree:true});
    window.DrillGREMath = {
      render,
      refresh: () => render(document.body)
    };
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded",start,{once:true});
  else start();
})();