(function(){
  function glow(e){
    document.documentElement.style.setProperty('--pointer-x',e.clientX+'px');
    document.documentElement.style.setProperty('--pointer-y',e.clientY+'px');
  }
  window.addEventListener('pointermove',glow,{passive:true});
  document.querySelectorAll('.service-row,.product-row,.audience-panel').forEach(function(el){
    el.addEventListener('pointermove',function(e){
      var r=el.getBoundingClientRect();
      el.style.setProperty('--x',((e.clientX-r.left)/r.width*100)+'%');
      el.style.setProperty('--y',((e.clientY-r.top)/r.height*100)+'%');
    });
  });
})();
