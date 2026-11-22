(function(){
  var el=document.getElementById('intro'),done=false;
  var ruhig=false; /* Intro läuft bewusst auch bei «Bewegung reduzieren» vollständig */
  function aufraeumen(ms){setTimeout(function(){el.remove();},ms);}
  /* Ende: Bild zerspringt in Splitter, die nach aussen fliegen */
  function boom(){
    if(done)return;done=true;
    if(ruhig){el.classList.add('weg');aufraeumen(350);return;}
    var n=12,ring=document.createDocumentFragment(),parts=[];
    function rand(a,b){return a+Math.random()*(b-a);}
    function rp(a,r){var dx=Math.cos(a),dy=Math.sin(a),t=50/Math.max(Math.abs(dx),Math.abs(dy))*1.6*r;return[50+dx*t,50+dy*t];}
    var cx=50,cy=48,cuts=[];
    for(var k=0;k<n;k++)cuts.push((k+rand(-.3,.3))/n*Math.PI*2);
    for(var k=0;k<n;k++){
      var a1=cuts[k],a2=cuts[(k+1)%n]+(k===n-1?Math.PI*2:0),am=(a1+a2)/2,r=rand(.22,.4);
      var i1=rp(a1,r),i2=rp(a2,r),o1=rp(a1,1),o2=rp(a2,1);
      parts.push({poly:[[cx,cy],i1,i2],a:am,d:rand(25,45)});
      parts.push({poly:[i1,o1,o2,i2],a:am,d:rand(60,110)});
    }
    parts.forEach(function(p){
      var s=document.createElement('div');s.className='i-shard';
      var cp='polygon('+p.poly.map(function(q){return q[0].toFixed(1)+'% '+q[1].toFixed(1)+'%';}).join(',')+')';s.style.webkitClipPath=cp;s.style.clipPath=cp;
      s.style.setProperty('--tx',(Math.cos(p.a)*p.d).toFixed(1)+'vw');s.style.setProperty('--ty',(Math.sin(p.a)*p.d).toFixed(1)+'vh');s.style.setProperty('--rot',rand(-35,35).toFixed(0)+'deg');
      ring.appendChild(s);
      p.el=s;
    });
    el.appendChild(ring);
    var fl=document.createElement('div');fl.className='i-flash';el.appendChild(fl);
    el.classList.add('boom');
    aufraeumen(2000);
  }
  el.addEventListener('click',boom);
  setTimeout(boom,ruhig?3000:6700);
})();