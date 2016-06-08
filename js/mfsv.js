var nextID = 1;

window.onload = function() {
	var divs = document.getElementsByClassName("mfsviewer");
	for (var i = 0; i < divs.length; i++) {
		new MFSViewer(divs[i], divs[i].getAttribute("width"), divs[i].getAttribute("height"), divs[i].getAttribute("objPath"));
	}
}

function MFSViewer(targetDiv, width, height, objPath) {
	var myself = this;

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
			var xRand = Math.random() - 0.5;
			var yRand = Math.random() - 0.5;
			this.mainSceneShaderMaterial.uniforms.aaNdcOffset.value.x = 2*xRand / this.width;
			this.mainSceneShaderMaterial.uniforms.aaNdcOffset.value.y = 2*yRand / this.height;
		}

		// feed the uniforms
		this.mainSceneShaderMaterial.uniforms.accBuffer.value = this.bufferFlipFlop ? this.secondAccumBuffer.texture : this.firstAccumBuffer.texture;
		this.mainSceneShaderMaterial.uniforms.weight.value = this.frameCount / (this.frameCount + 1);

		// accumulate the newest frame
		if(this.bufferFlipFlop)
			this.renderer.render(this.mainScene, this.mainCamera, this.firstAccumBuffer, false);
		else
			this.renderer.render(this.mainScene, this.mainCamera, this.secondAccumBuffer, false);

		// render the current accumulation buffer to the view buffer
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
	this.renderer = new THREE.WebGLRenderer( { alpha: true } );
	this.renderer.setSize(this.width, this.height);
	this.renderer.setPixelRatio(window.devicePixelRatio);
	this.renderer.setClearColor(0x000000, 0);

	// set up buffers
	var texturePrecision;
	if (this.renderer.context.getExtension('OES_texture_float') !== null) {
		texturePrecision = THREE.FloatType;
		this.log('FLOAT texture precision supported and will be used.');
	} else if (this.renderer.context.getExtension('OES_texture_half_float') !== null) {
		texturePrecision = THREE.HalfFloatType;
		this.log('HALFFLOAT texture precision supported and will be used.');
	} else {
		texturePrecision = THREE.UnsignedByte;
		this.log('UNSIGNED BYTE texture precision will be used.');
	}
	var bufferSettings = {
		minFilter: THREE.NearestFilter,
		magFilter: THREE.NearestFilter,
		format: THREE.RGBAFormat,
		type: texturePrecision
	};
	this.firstAccumBuffer = new THREE.WebGLRenderTarget(this.width, this.height, bufferSettings);
	this.secondAccumBuffer = new THREE.WebGLRenderTarget(this.width, this.height, bufferSettings);
	this.newFrameBuffer = new THREE.WebGLRenderTarget(this.width, this.height, bufferSettings);

	// initialize cameras
	this.mainCamera = new THREE.PerspectiveCamera(75, this.width / this.height, 0.1, 2000);
	this.mainCamera.position.z = 7;
	this.finalCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

	// prepare scenes
	this.mainScene = new THREE.Scene();
	this.mainScene.add(this.mainCamera);
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
		uniform vec2 viewport;
		uniform float weight;
		uniform sampler2D accBuffer;

		void main() {
				float dProd = max(0.0, dot(vNormal, normalize(cameraPosition)));
				vec4 newFragColor = vec4(vec3(dProd), 1.0);
				vec4 accColor = texture2D(accBuffer, gl_FragCoord.xy / viewport.xy);
				gl_FragColor = mix(newFragColor, accColor, weight);
			}
		`;
	this.mainSceneShaderMaterial = new THREE.ShaderMaterial({
		uniforms: {
			accBuffer: { value: this.firstAccumBuffer.texture },
			antiAliasing: { value: true },
			weight: { value: 0.0 },
			viewport: { value: new THREE.Vector2(this.width, this.height) },
			aaNdcOffset: { value: new THREE.Vector2(0.0, 0.0) }
		},
		vertexShader: mainSceneVertexShader,
		fragmentShader: mainSceneFragmentShader
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
	this.finalQuad = new THREE.Mesh(new THREE.PlaneBufferGeometry(2, 2), new THREE.MeshBasicMaterial( { transparent: true } ));
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
