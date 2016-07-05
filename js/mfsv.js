var nextID = 1;

window.onload = function() {
	var divs = document.getElementsByClassName("mfsviewer");
	for (var i = 0; i < divs.length; i++) {
		new MFSViewer(divs[i], { objPath: divs[i].getAttribute("objPath"), jsonPath: divs[i].getAttribute("jsonPath") });
	}
	try { setupEval(); } catch(err) { console.log("setupEval failed, no stats available.") }
}

function MFSViewer(div, settings) {
	this.animate = function() {
		_this.controls.update();
		if (_this.frameCount < _this.frameCountTarget || _this.renderAlways) {
			_this.render();
		}
		requestAnimationFrame(_this.animate);
	};

	this.log = function(logContent) {
		console.log("[MFSViewer #"+_this.id+"]", logContent);
	}

	this.requestRender = function() {
		if(_this.frameCount != 0) {
			_this.log("Requesting new frame set!");
			_this.frameCount = 0;
		}
	}

	this.render = function() {
		// artificial frame time limitation for multi-sampling presentation
		currentTime = new Date().getTime();
		if ((currentTime - this.lastRender) < this.minimumFrameTime) { return }
		this.lastRender = currentTime;

		if (this.effectOptions.antiAliasing) {
			var xRand = Math.random() - 0.5;
			var yRand = Math.random() - 0.5;
			for (i = 0; i < this.allMaterials.length; i++) {
				this.allMaterials[i].ndcOffset.x = this.debugOptions.aaNdcOffsetMultiplier * 2 * xRand / this.width;
				this.allMaterials[i].ndcOffset.y = this.debugOptions.aaNdcOffsetMultiplier * 2 * yRand / this.height;
			}
		}
		if (this.effectOptions.softShadows) {
			var xRand = this.debugOptions.ssLightOffsetMultiplier * (Math.random() - 0.5);
			var yRand = this.debugOptions.ssLightOffsetMultiplier * (Math.random() - 0.5);
			var zRand = this.debugOptions.ssLightOffsetMultiplier * (Math.random() - 0.5);
			this.light.position.set(this.light.basePosition.x + xRand, this.light.basePosition.y + yRand, this.light.basePosition.z + zRand);
		} else if (this.frameCount == 0) {
			this.light.position.set(this.light.basePosition.x, this.light.basePosition.y, this.light.basePosition.z);
		}
		if (this.effectOptions.depthOfField) {
			var xRand = Math.random() - 0.5;
			var yRand = Math.random() - 0.5;
			for (i = 0; i < this.allMaterials.length; i++) {
				this.allMaterials[i].focalDistance = this.depthOfFieldOptions.focalDistance;
				this.allMaterials[i].cocPoint.x = this.debugOptions.dofCoCPointMultiplier * 2 * xRand;
				this.allMaterials[i].cocPoint.y = this.debugOptions.dofCoCPointMultiplier * 2 * yRand;
			}
		}

		// generate new frame from main scene
		this.renderer.render(this.mainScene, this.mainCamera, this.newFrameBuffer);

		// mix our previously accumulated image with our new frame in the mix scene
		this.mixSceneShaderMaterial.uniforms.newFrame.value = this.newFrameBuffer.texture;
		this.mixSceneShaderMaterial.uniforms.lastFrame.value = this.bufferFlipFlop ? this.secondAccumBuffer.texture : this.firstAccumBuffer.texture;
		this.mixSceneShaderMaterial.uniforms.weight.value = this.frameCount / (this.frameCount + 1);
		this.renderer.render(this.mixScene, this.mixCamera, this.bufferFlipFlop ? this.firstAccumBuffer : this.secondAccumBuffer);

		// render our new accumulated image to the screen (our final scene)
		this.finalQuad.material.map = !this.bufferFlipFlop ? this.secondAccumBuffer.texture : this.firstAccumBuffer.texture;
		this.renderer.render(this.finalScene, this.finalCamera);

		this.bufferFlipFlop = !this.bufferFlipFlop;
		this.frameCount++;
    try { evalTick(); } catch(err) {}
	}

	this.resize = function() {
		if (_this.fixedSize) {
				return;
		}
		var w = _this.div.offsetParent.offsetWidth, h = _this.div.offsetParent.offsetHeight;
		_this.renderer.setSize(w, h);
		w *= _this.dpr;
		h *= _this.dpr;
		_this.mainCamera.aspect = w / h;
		_this.mainCamera.updateProjectionMatrix();
		_this.firstAccumBuffer.setSize(w, h);
		_this.secondAccumBuffer.setSize(w, h);
		_this.newFrameBuffer.setSize(w, h);
		_this.mixSceneShaderMaterial.uniforms.viewport.value = new THREE.Vector2(w, h);
		_this.width = w;
		_this.height = h;
		_this.requestRender();
	}

	/*
	*	Loads a textured .json model (created by the python script from the root directory) into the specified scene.
	*/
	this.loadJSONModel = function(jsonPath, manager, texturePath, scene) {
		var loader = new THREE.JSONLoader(manager);
		loader.setTexturePath(texturePath);
		loader.load(settings.jsonPath, function (geometry, materials) {
			// set up materials
			materials.forEach(function(mat) {
				if (mat.map) {
					mat.map.wrapS = THREE.RepeatWrapping; // enable repeat texture mode
					mat.map.wrapT = THREE.RepeatWrapping;
				}
				_this.allMaterials.push(mat);
				mat.ndcOffset = new THREE.Vector2(0.0, 0.0);
				mat.cocPoint = new THREE.Vector2(0.0, 0.0);
				mat.focalDistance = 0.0;
			} );

			// normalize model size
			s = 4 / geometry.boundingSphere.radius;
			geometry = geometry.scale(s, s, s);

			// configure & load model into scene
			_this.model = new THREE.Mesh(geometry, new THREE.MeshFaceMaterial(materials));
			_this.model.castShadow = true;
			_this.model.receiveShadow = true;
			scene.add(_this.model);
		} );
	}

	/**
	* Loads an untextured, raw .obj model into the specified scene.
	*/
	this.loadPlainOBJModel = function(objPath, manager, scene) {
		var loader = new THREE.OBJLoader(manager);
		loader.load(objPath, function (object) {
			object.traverse(function(child) {
				if (child instanceof THREE.Mesh) {
					child.material = new THREE.MeshLambertMaterial();
					child.castShadow = true;
					child.receiveShadow = true;
					child.material.ndcOffset = new THREE.Vector2(0.0, 0.0);
					child.material.cocPoint = new THREE.Vector2(0.0, 0.0);
					_this.allMaterials.push(child.material);
				}
			} );
			_this.model = object;
			scene.add(object);
		} );
	}

	this.initialize = function(settings) {
		function getURLParameter(name) {
			return decodeURIComponent((new RegExp('[?|&]' + name + '=' + '([^&;]+?)(&|#|;|$)').exec(location.search) || [null, ''])[1].replace(/\+/g, '%20')) || null;
		}

		// set width & height
		this.fixedSize = (settings.width || settings.height);
		this.width = settings.width || div.offsetParent.offsetWidth;
		this.height = settings.height || div.offsetParent.offsetHeight;
		this.dpr = Math.ceil(window.devicePixelRatio);
		window.addEventListener('resize', this.resize, false);

		// misc vars
		this.frameCount = 0;
		this.frameCountTarget = 64;
		this.bufferFlipFlop = true;
		this.id = nextID++;

		// prepare renderer
		this.renderer = new THREE.WebGLRenderer( { alpha: true } );
		this.renderer.shadowMap.enabled = true;
		this.renderer.setSize(this.width, this.height);
		this.renderer.setPixelRatio(this.dpr);
		this.renderer.setClearColor(0x000000, 0);
		this.width = this.width * this.dpr;
		this.height = this.height * this.dpr;
		this.lastRender = new Date().getTime();
		this.renderAlways = false;

		// DETECT TEXTURE PRECISION
		// .getExtension activates the extension
		// 		WEBGL_color_buffer_float -> WebGL 1 (https://developer.mozilla.org/en-US/docs/Web/API/WEBGL_color_buffer_float)
		// 		EXT_color_buffer_float & EXT_color_buffer_half_float -> WebGL 2 (https://developer.mozilla.org/en-US/docs/Web/API/EXT_color_buffer_float)
		var texturePrecision;
		if (this.renderer.context.getExtension('WEBGL_color_buffer_float') !== null || this.renderer.context.getExtension('EXT_color_buffer_float') !== null || getURLParameter('forcefloat')) {
			texturePrecision = THREE.FloatType;
			this.log('FLOAT texture precision will be used.');
		} else if (this.renderer.context.getExtension('EXT_color_buffer_half_float') !== null) {
			texturePrecision = THREE.HalfFloatType;
			this.log('HALFFLOAT texture precision will be used.');
		} else {
			texturePrecision = THREE.UnsignedByteType;
			this.log('UNSIGNED BYTE texture precision will be used.');
		}

		// set up textures
		var bufferSettings = {
			minFilter: THREE.LinearFilter,
			magFilter: THREE.LinearFilter,
			format: THREE.RGBAFormat,
			type: texturePrecision
		};
		this.firstAccumBuffer = new THREE.WebGLRenderTarget(this.width, this.height, bufferSettings);
		this.secondAccumBuffer = new THREE.WebGLRenderTarget(this.width, this.height, bufferSettings);
		this.newFrameBuffer = new THREE.WebGLRenderTarget(this.width, this.height, bufferSettings);

		// initialize cameras
		this.mainCamera = new THREE.PerspectiveCamera(75, this.width / this.height, 0.1, 10000);
		this.mainCamera.position.z = 1;
		this.mixCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
		this.finalCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

		// prepare scenes
		this.mainScene = new THREE.Scene();
		this.mainScene.add(this.mainCamera);
		this.mixScene = new THREE.Scene();
		this.mixScene.add(this.mixCamera);
		this.finalScene = new THREE.Scene();
		this.finalScene.add(this.finalCamera);

		// set up light
		this.light = new THREE.SpotLight(0xffffff, 2, 20);
		this.light.castShadow = true;
		this.light.shadow.mapSize.width = parseInt(getURLParameter("shadowMapSize")) || 2048;
		this.light.shadow.mapSize.height = parseInt(getURLParameter("shadowMapSize")) || 2048;
		this.light.shadow.camera.near = 0.001;
		this.light.shadow.camera.far = 4000;
		this.light.shadow.camera.fov = 75;
		this.mainScene.add(this.light);

		// accumulation shaders
		var mixSceneVertexShader = " \n"+
			"// switch on high precision floats \n"+
			"#ifdef GL_ES \n"+
			"precision highp float; \n"+
			"#endif \n"+
	 		"\n"+
			"void main() { \n"+
			"		gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); \n"+
			"}";
		var mixSceneFragmentShader = " \n"+
			"// switch on high precision floats \n"+
			"#ifdef GL_ES \n"+
			"precision highp float; \n"+
			"#endif \n"+
	 		"\n"+
			"uniform vec2 viewport; \n"+
			"uniform float weight; \n"+
			"uniform sampler2D newFrame; \n"+
			"uniform sampler2D lastFrame; \n"+
	 		"\n"+
			"void main() { \n"+
			"		vec4 newColor = texture2D(newFrame, gl_FragCoord.xy / viewport.xy); \n"+
			"		vec4 accColor = texture2D(lastFrame, gl_FragCoord.xy / viewport.xy); \n"+
			"		gl_FragColor = mix(newColor, accColor, weight); \n"+
			"}";

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
		manager.onProgress = function (item, loaded, total) {
			_this.log("Loaded item " + item + " (" + loaded + " of " + total + " objects)");
		};
		manager.onLoad = function () {
			_this.log("Loading finished!");
			_this.animate();
		};

		// remember all materials so we can set the NDC offset for each individual shader later
		this.allMaterials = new Array;
		if (settings.objPath) {
			this.loadPlainOBJModel(settings.objPath, manager, this.mainScene);
		}
		if (settings.jsonPath) {
			this.loadJSONModel(settings.jsonPath, manager, settings.jsonPath.substring(0, settings.jsonPath.lastIndexOf("/"))+"/textures/", this.mainScene);
		}

		// load quad for finalScene
		this.mixQuad = new THREE.Mesh(new THREE.PlaneBufferGeometry(2, 2), this.mixSceneShaderMaterial);
		this.mixScene.add(this.mixQuad);
		this.finalQuad = new THREE.Mesh(new THREE.PlaneBufferGeometry(2, 2), new THREE.MeshBasicMaterial( { transparent: true } ));
		this.finalScene.add(this.finalQuad);

		// attach the render-supplied DOM element
		div.appendChild(this.renderer.domElement);
		this.div = div;

		// configure trackball controls
		this.controls = new THREE.TrackballControls(this.mainCamera, this.renderer.domElement);
		this.controls.addEventListener('change', this.requestRender);
		this.controls.target.set(0, 0, 0);
		this.controls.rotateSpeed = 5.0;
		this.controls.zoomSpeed = 2;
		this.controls.panSpeed = 10;
		this.controls.noZoom = false;
		this.controls.noPan = false;
		this.controls.staticMoving = true;
		this.controls.dynamicDampingFactor = 0;
		this.controls.keys = [ 65, 83, 68 ];

		// set up gui
		this.gui = new dat.GUI();
		this.gui.width = 300;
		this.guiOptions = {
			"ViewerID(ReadOnly)": this.id,
			targetFrameCount: 64,
			minimumFrameTime: 0.0,
			renderAlways: this.renderAlways
		};
		this.effectOptions = {
			antiAliasing: true,
			softShadows: true,
			depthOfField: true
		};
		this.depthOfFieldOptions = {
			focalDistance: 0.5
		};
		this.lightOptions = {
			lightIntensity: 2.0,
			followCamera: true
		};
		this.debugOptions = {
			aaNdcOffsetMultiplier: 1.0,
			ssLightOffsetMultiplier: 0.027,
			dofCoCPointMultiplier: 0.005
		};
		this.updateTargetFrameCount = function() {
			var newFrameCountTarget = _this.guiOptions.targetFrameCount;
			if (newFrameCountTarget != _this.frameCountTarget && newFrameCountTarget > 0) {
				_this.frameCountTarget = newFrameCountTarget;
				_this.requestRender();
			}
		};
		this.updateRenderSettings = function () {
			_this.minimumFrameTime = _this.guiOptions.minimumFrameTime;
			_this.renderAlways = _this.guiOptions.renderAlways;
			_this.requestRender();
		}
		this.updateLightMode = function () {
			if (_this.lightOptions.followCamera) {
				_this.light.basePosition = _this.mainCamera.position;
				_this.light.position = _this.light.basePosition.clone();
				_this.light.rotation = _this.mainCamera.rotation;
			} else {
				_this.light.basePosition = _this.light.basePosition.clone();
				_this.light.position = _this.light.basePosition.clone();
				_this.light.rotation = _this.light.rotation.clone();
			}
			_this.requestRender();
		}
		this.updateLightSettings = function () {
			_this.light.intensity = _this.lightOptions.lightIntensity;
			_this.requestRender();
		}
		this.updateTargetFrameCount();
		this.updateRenderSettings();
		this.updateLightSettings();
		this.updateLightMode();

		this.gui.add(this.guiOptions, "ViewerID(ReadOnly)");
		var f1 = this.gui.addFolder("Multi-frame Sampling");
		f1.add(this.guiOptions, "targetFrameCount", 1, 128).onChange(this.updateTargetFrameCount);
		f1.add(this.guiOptions, "renderAlways").onChange(this.updateRenderSettings);
		f1.add(this.guiOptions, "minimumFrameTime", 0, 500).onChange(this.updateRenderSettings);
		f1.open();
		var f2 = this.gui.addFolder("Effects");
		f2.add(this.effectOptions, "antiAliasing").onChange(this.requestRender);
		f2.add(this.effectOptions, "softShadows").onChange(this.requestRender);
		f2.add(this.effectOptions, "depthOfField").onChange(this.requestRender);
		f2.open();
		var f3 = this.gui.addFolder("Light");
		f3.add(this.lightOptions, "followCamera").onChange(this.updateLightMode);
		f3.add(this.lightOptions, "lightIntensity", 1, 5).onChange(this.updateLightSettings);
		f3.open();
		var f4 = this.gui.addFolder("Depth of Field");
		f4.add(this.depthOfFieldOptions, "focalDistance", 0, 10).onChange(this.requestRender);
		f4.open();
		var f5 = this.gui.addFolder("Debugging");
		f5.add(this.debugOptions, "aaNdcOffsetMultiplier", 1, 300).onChange(this.requestRender);
		f5.add(this.debugOptions, "ssLightOffsetMultiplier", 0, 0.1).onChange(this.requestRender);
		f5.add(this.debugOptions, "dofCoCPointMultiplier", 0, 0.02).onChange(this.requestRender);
		f5.open();
	}

	var _this = window.mfsv = this;
	this.initialize(settings);
}
