# mfsv

A prototypical WebGL-based Multi-frame Sampling viewer for 3D scenes. Currently using [Three.js](https://github.com/mrdoob/three.js/). Examples hosted [here](https://emberflare.github.io/mfsv/).

## How to embed the viewer
<pre>&lt;div class="mfsviewer" objPath="obj/mitsuba.obj"&gt;</pre>

## Optional URL Parameters

<pre>emberflare.github.io/mfsv/demo-teapot.html?shadowMapSize=512&forcefloat=1</pre>

* shadowMapSize: Sets the width and height for the shadow map.
* forcefloat: Forces the renderer to use float texture precision, regardless of detected WebGL extensions.
