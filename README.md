# MFSV: A Multi-frame Sampling Viewer in WebGL

A prototypical WebGL-based Multi-frame Sampling viewer for 3D scenes using [Three.js](https://github.com/mrdoob/three.js/). Based on the paper "Progressive Rendering using Multi-Frame Sampling" by Daniel Limberger, Karsten Tausche, Johannes Linke, and Jürgen Döllner (published in GPU Pro 7, edited by Wolfgang Engel, pp.125-141, 2016).

**[Click here](https://msoechting.github.io/mfsv/) for examples.**

## Features
* Kernel-based Multi-frame Sampling
	* Anti-Aliasing
	* Soft Shadows
	* Depth-of-Field
	* SSAO
* Trackball controls
* Presets for light and camera position
* Automatic detection of highest texture precision for render targets (float > half-float > byte)
* DPI-sensitive rendering (no blurry images on high DPI displays)

## Supported model formats
* Untextured .obj models
* [JSON Model Format](https://github.com/mrdoob/three.js/wiki/JSON-Model-format-3)

## Usage
### Step 1: Include .js files
[Get](https://github.com/msoechting/mfsv/tree/master/js) and include the following .js files in your HTML code:
* mfsv.js
* kernels.js
* three.js
* TrackballControls.js
* dat.gui.js
* OBJLoader.js
* stats.js (optional)
* eval.js (optional)

### Step 2: Displaying a model
#### OBJ model
<pre>&lt;div class="mfsviewer" objPath="obj/mitsuba.obj"&gt;</pre>

#### JSON model format
<pre>&lt;div class="mfsviewer" jsonPath="obj/crytek-sponza.json"&gt;</pre>

All textures need to be located in a subdirectory called "textures" relative to the model file. A Python script to convert textured .obj models into JSON models can be found [here](https://github.com/mrdoob/three.js/blob/master/utils/converters/obj/convert_obj_three.py).


### Optional URL Parameters

<pre>msoechting.github.io/mfsv/demo-teapot.html?shadowMapSize=512&forcefloat=1</pre>

* shadowMapSize: Sets the width and height for the shadow map.
* forcefloat: If set to 1, forces the renderer to use float texture precision, regardless of detected WebGL extensions.
