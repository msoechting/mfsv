var nextID = 1;

window.onload = function() {
	var divs = document.getElementsByClassName("mfsviewer");
	for (var i = 0; i < divs.length; i++) {
		new MFSViewer(divs[i], divs[i].getAttribute("width"), divs[i].getAttribute("height"), divs[i].getAttribute("objPath"));
	}
}

function MFSViewer(targetDiv, width, height, objPath) {
	var myself = this;
	var kernel = [
		151, 160, 137,  91,  90,  15, 131,  13, 201,  95,  96,  53, 194, 233,   7, 225,
    140,  36, 103,  30,  69, 142,   8,  99,  37, 240,  21,  10,  23, 190,   6, 148,
    247, 120, 234,  75,   0,  26, 197,  62,  94, 252, 219, 203, 117,  35,  11,  32,
     57, 177,  33,  88, 237, 149,  56,  87, 174,  20, 125, 136, 171, 168,  68, 175,
     74, 165,  71, 134, 139,  48,  27, 166,  77, 146, 158, 231,  83, 111, 229, 122,
     60, 211, 133, 230, 220, 105,  92,  41,  55,  46, 245,  40, 244, 102, 143,  54,
     65,  25,  63, 161,   1, 216,  80,  73, 209,  76, 132, 187, 208,  89,  18, 169,
    200, 196, 135, 130, 116, 188, 159,  86, 164, 100, 109, 198, 173, 186,   3,  64,
     52, 217, 226, 250, 124, 123,   5, 202,  38, 147, 118, 126, 255,  82,  85, 212,
    207, 206,  59, 227,  47,  16,  58,  17, 182, 189,  28,  42, 223, 183, 170, 213,
    119, 248, 152,   2,  44, 154, 163,  70, 221, 153, 101, 155, 167,  43, 172,   9,
    129,  22,  39, 253,  19,  98, 108, 110,  79, 113, 224, 232, 178, 185, 112, 104,
    218, 246,  97, 228, 251,  34, 242, 193, 238, 210, 144,  12, 191, 179, 162, 241,
     81,  51, 145, 235, 249,  14, 239, 107,  49, 192, 214,  31, 181, 199, 106, 157,
    184,  84, 204, 176, 115, 121,  50,  45, 127,   4, 150, 254, 138, 236, 205,  93,
    222, 114,  67,  29,  24,  72, 243, 141, 128, 195,  78,  66, 215,  61, 156, 180];

	this.animate = function() {
		requestAnimationFrame(myself.animate);
		myself.controls.update();
		if (myself.frameCount < myself.frameCountTarget) {
			myself.render();
			myself.frameCount++;
			myself.log("Rendered " + myself.frameCount + "/" + myself.frameCountTarget + " frames");
		}
	};

	this.log = function(logContent) {
		console.log("[MFSViewer #"+myself.id+"]", logContent);
	}

	this.requestRender = function() {
		myself.log("Requesting new frame set!");
		myself.frameCount = 0;
	}

	this.render = function() {
		if (this.mainSceneShaderMaterial.uniforms.antiAliasing.value) {
			var xRand = kernel[this.frameCount % 255] / 255 - 0.5;
			var yRand = kernel[this.frameCount % 255] / 255 - 0.5; //1*(Math.random() - 0.5);
			this.mainSceneShaderMaterial.uniforms.aaNdcOffset.value.x = xRand / this.width;
			this.mainSceneShaderMaterial.uniforms.aaNdcOffset.value.y = yRand / this.height;
		}

		// generate new frame from main scene
		this.renderer.render(this.mainScene, this.mainCamera, this.newFrameBuffer);
		this.mixSceneShaderMaterial.uniforms.newFrame.value = this.newFrameBuffer.texture;

		this.mixSceneShaderMaterial.uniforms.lastFrame.value = this.bufferFlipFlop ? this.secondAccumBuffer.texture : this.firstAccumBuffer.texture;
		this.mixSceneShaderMaterial.uniforms.weight.value = this.frameCount / (this.frameCount + 1);

		// mix our accum buffer with our new frame in the mix scene
		if(this.bufferFlipFlop)
			this.renderer.render(this.mixScene, this.mixCamera, this.firstAccumBuffer, false);
		else
			this.renderer.render(this.mixScene, this.mixCamera, this.secondAccumBuffer, false);

		// render the output from the mix scene to our final scene and
		this.finalQuad.material.map = !this.bufferFlipFlop ? this.secondAccumBuffer.texture : this.firstAccumBuffer.texture;
		this.renderer.render(this.finalScene, this.finalCamera);

		this.bufferFlipFlop = !this.bufferFlipFlop;
	}

	// set misc vars
	this.width = width;
	this.height = height;
	this.frameCount = 0;
	this.frameCountTarget = 64;
	this.bufferFlipFlop = true;
	this.id = nextID++;

	// prepare renderer
	this.renderer = new THREE.WebGLRenderer( { alpha: true, premultipliedAlpha: false } );
	this.renderer.setSize(this.width, this.height);
	this.renderer.setPixelRatio(window.devicePixelRatio);
	this.renderer.setClearColor(0xffffff, 0);
	if (this.renderer.getPrecision() == "highp") {
		this.log("High Precision Floats are supported and will be used.");
	}

	// set up buffers
	var bufferSettings = {
		minFilter: THREE.NearestFilter,
		magFilter: THREE.NearestFilter,
		format: THREE.RGBAFormat,
		type: THREE.FloatType
	};
	this.firstAccumBuffer = new THREE.WebGLRenderTarget(this.width, this.height, bufferSettings);
	this.secondAccumBuffer = new THREE.WebGLRenderTarget(this.width, this.height, bufferSettings);
	this.newFrameBuffer = new THREE.WebGLRenderTarget(this.width, this.height, bufferSettings);

	// initialize cameras
	this.mainCamera = new THREE.PerspectiveCamera(75, this.width / this.height, 0.1, 2000);
	this.mainCamera.position.z = 7;
	this.mixCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
	this.finalCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

	// prepare scenes
	this.mainScene = new THREE.Scene();
	this.mainScene.add(this.mainCamera);
	this.mixScene = new THREE.Scene();
	this.mixScene.add(this.mixCamera);
	this.finalScene = new THREE.Scene();
	this.finalScene.add(this.finalCamera);

	// load shaders
	var mainSceneVertexShader = `
		// switch on high precision floats
		#ifdef GL_ES
		precision highp float;
		#endif

		varying vec3 vNormal;
		uniform bool antiAliasing;
		uniform vec2 aaNdcOffset;

		void main() {
				vNormal = normal;
				vec4 ndcVertex = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
				if (antiAliasing) {
					ndcVertex.xy += aaNdcOffset * ndcVertex.w;
				}
				gl_Position = ndcVertex;
			}
		`;
	var mainSceneFragmentShader = `
		// switch on high precision floats
		#ifdef GL_ES
		precision highp float;
		#endif

		varying vec3 vNormal;

		void main() {
				float dProd = max(0.0, dot(vNormal, normalize(cameraPosition)));
				gl_FragColor = vec4(dProd, dProd, dProd, 1.0);
			}
		`;
	var mixSceneVertexShader = `
		// switch on high precision floats
		#ifdef GL_ES
		precision highp float;
		#endif

		void main() {
				gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
			}
		`;
	var mixSceneFragmentShader = `
		// switch on high precision floats
		#ifdef GL_ES
		precision highp float;
		#endif

		uniform vec2 viewport;
		uniform float weight;
		uniform sampler2D newFrame;
		uniform sampler2D lastFrame;

		void main() {
				vec4 newColor = texture2D(newFrame, gl_FragCoord.xy / viewport.xy);
				vec4 accColor = texture2D(lastFrame, gl_FragCoord.xy / viewport.xy);
				gl_FragColor = mix(newColor, accColor, weight);
			}
		`;
	this.mainSceneShaderMaterial = new THREE.ShaderMaterial({
		uniforms: {
			antiAliasing: { value: true },
			aaNdcOffset: { value: new THREE.Vector2(0.0, 0.0) }
		},
		vertexShader: mainSceneVertexShader,
		fragmentShader: mainSceneFragmentShader
	});
	this.mixSceneShaderMaterial = new THREE.ShaderMaterial({
		uniforms: {
			lastFrame: { value: this.firstAccumBuffer.texture },
			newFrame: { value: this.firstAccumBuffer.texture },
			weight: { value: 0.0 },
			viewport: { value: new THREE.Vector2(this.width, this.height) }
		},
		vertexShader: mixSceneVertexShader,
		fragmentShader: mixSceneFragmentShader
	});

	// load and add our object to the scene
	var manager = new THREE.LoadingManager();
	var log = this.log, animate = this.animate;
	manager.onProgress = function (item, loaded, total) {
		log("Loaded item " + item + " (" + loaded + " of " + total + " objects)");
	};
	manager.onLoad = function () {
		log("Loading finished!");
		animate();
	};

	var loader = new THREE.OBJLoader(manager), material = this.mainSceneShaderMaterial, targetScene = this.mainScene;
	loader.load(objPath, function (object) {
		object.traverse(function(child) {
			if (child instanceof THREE.Mesh) {
				child.material = material;
			}
		} );
		targetScene.add(object);
	} );

	// load quad for finalScene
	this.mixQuad = new THREE.Mesh(new THREE.PlaneBufferGeometry(2, 2), this.mixSceneShaderMaterial);
	this.mixScene.add(this.mixQuad);
	this.finalQuad = new THREE.Mesh(new THREE.PlaneBufferGeometry(2, 2), new THREE.MeshBasicMaterial( { transparent: false } ));
	this.finalScene.add(this.finalQuad);

	// attach the render-supplied DOM element
	targetDiv.appendChild(this.renderer.domElement);

	// configure trackball controls
	this.controls = new THREE.TrackballControls(this.mainCamera, this.renderer.domElement);
	this.controls.addEventListener('change', this.requestRender);
	this.controls.target.set(0, 0, 0);
	this.controls.rotateSpeed = 5.0;
	this.controls.zoomSpeed = 1.2;
	this.controls.panSpeed = 0.8;
	this.controls.noZoom = false;
	this.controls.noPan = false;
	this.controls.staticMoving = true;
	this.controls.dynamicDampingFactor = 0.3;
	this.controls.keys = [ 65, 83, 68 ];

	// set up gui
	this.gui = new dat.GUI();
	this.gui.width = 300;
	var guiOptions = {
		"ViewerID(ReadOnly)": myself.id,
		targetFrameCount: "64",
		antiAliasing: true
	};
	var updateTargetFrameCount = function() {
		var newFrameCountTarget = parseFloat(guiOptions.targetFrameCount).toFixed(0);
		if (newFrameCountTarget != myself.frameCountTarget && newFrameCountTarget > 0) {
			myself.frameCountTarget = newFrameCountTarget;
			myself.requestRender();
		}
	};
	var updateRenderSettings = function () {
		myself.mainSceneShaderMaterial.uniforms.antiAliasing.value = guiOptions.antiAliasing;
		myself.requestRender();
	}
	updateTargetFrameCount();
	updateRenderSettings();
	this.gui.add(guiOptions, "ViewerID(ReadOnly)");
	this.gui.add(guiOptions, "targetFrameCount").onChange(updateTargetFrameCount);
	this.gui.add(guiOptions, "antiAliasing", true).onChange(updateRenderSettings);
}
