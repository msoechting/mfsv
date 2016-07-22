var nextID = 1;

window.onload = function() {
	var divs = document.getElementsByClassName("mfsviewer");
	for (var i = 0; i < divs.length; i++) {
		new MFSViewer(divs[i], { objPath: divs[i].getAttribute("objPath"), jsonPath: divs[i].getAttribute("jsonPath") });
	}
	try { setupEval(); } catch(err) { console.log("setupEval failed, no stats available.") }
}

function MFSViewer(div, settings) {
	/*
	* 	LOGGING
	*/

	this.log = function(logContent) {
		console.log("[MFSViewer #"+_this.id+"]", logContent);
	}
	this.warn = function(logContent) {
		console.warn("[MFSViewer #"+_this.id+"]", logContent);
	}

	/*
	* 	RENDERING
	*/

	this.requestRender = function() {
		if(_this.frameCount != 0) {
			_this.log("Requesting new frame set!");
			_this.frameCount = 0;
		}
	}
	this.animate = function() {
		_this.controls.update();
		if (_this.frameCount < _this.frameCountTarget || _this.guiOptions.mfs.renderAlways) {
			_this.render();
		}
		requestAnimationFrame(_this.animate);
	};
	this.render = function() {
		// artificial frame time limitation for multi-sampling presentation
		currentTime = new Date().getTime();
		if ((currentTime - this.lastRender) < this.minimumFrameTime) { return }
		this.lastRender = currentTime;

		if (this.guiOptions.effects.antiAliasing) {
			var xRand = Math.random() - 0.5;
			var yRand = Math.random() - 0.5;
			for (i = 0; i < this.allMaterials.length; i++) {
				this.allMaterials[i].ndcOffset.x = this.guiOptions.debug.aaNdcOffsetMultiplier * 2 * xRand / this.width;
				this.allMaterials[i].ndcOffset.y = this.guiOptions.debug.aaNdcOffsetMultiplier * 2 * yRand / this.height;
			}
		}
		if (this.guiOptions.effects.softShadows) {
			var xRand = this.guiOptions.debug.ssLightOffsetMultiplier * (Math.random() - 0.5);
			var yRand = this.guiOptions.debug.ssLightOffsetMultiplier * (Math.random() - 0.5);
			var zRand = this.guiOptions.debug.ssLightOffsetMultiplier * (Math.random() - 0.5);
			this.light.position.set(this.light.basePosition.x + xRand, this.light.basePosition.y + yRand, this.light.basePosition.z + zRand);
		} else if (this.frameCount == 0) {
			this.light.position.copy(this.light.basePosition);
		}
		if (this.guiOptions.effects.depthOfField) {
			var xRand = Math.random() - 0.5;
			var yRand = Math.random() - 0.5;
			for (i = 0; i < this.allMaterials.length; i++) {
				this.allMaterials[i].focalDistance = this.guiOptions.depthOfField.focalDistance;
				this.allMaterials[i].cocPoint.x = this.guiOptions.debug.dofCoCPointMultiplier * 2 * xRand;
				this.allMaterials[i].cocPoint.y = this.guiOptions.debug.dofCoCPointMultiplier * 2 * yRand;
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
	* 	MODEL LOADING
	*/

	/*	this.loadJSONModel
	* Loads a textured .json model (created by the python script below) into the specified scene.
	* https://github.com/mrdoob/three.js/blob/master/utils/converters/obj/convert_obj_three.py
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
	/*  this.loadPlainOBJModel
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

	/*
	* 	PRESETS
	*/

	this.applyScenePreset = function(preset) {
		this.controls.reset();
		this.guiOptions.light.followCamera = false;
		this.updateLightMode();
		this.guiOptions.depthOfField.focalDistance = preset.effects.dofFocalDistance;
		this.guiOptions.effects.depthOfField = preset.effects.depthOfField;
		this.light.position.copy(preset.light.eye);
		this.light.basePosition.copy(this.light.position);
		this.light.up.copy(preset.light.up);
		this.light.lookAt(preset.light.target);
		this.mainCamera.position.copy(preset.camera.eye);
		this.mainCamera.up.copy(preset.camera.up);
		this.mainCamera.lookAt(preset.camera.target);
		this.requestRender();
	}
	this.encodeCurrentSceneAsPreset = function() {
		var lightTarget = this.light.basePosition.clone().add(this.light.getWorldDirection());
		var cameraTarget = this.mainCamera.position.clone().add(this.mainCamera.getWorldDirection());
		var preset = "{ \n"+
		  "	light: {\n"+
			"		eye: new THREE.Vector3("+this.light.basePosition.x+","+this.light.basePosition.y+","+this.light.basePosition.z+"),\n"+
			"		up: new THREE.Vector3("+this.light.up.x+","+this.light.up.y+","+this.light.up.z+"),\n"+
			"		target: new THREE.Vector3("+lightTarget.x+","+lightTarget.y+","+lightTarget.z+")\n"+
		  "	},\n"+
		  "	camera: {\n"+
			"		eye: new THREE.Vector3("+this.mainCamera.position.x+","+this.mainCamera.position.y+","+this.mainCamera.position.z+"),\n"+
			"		up: new THREE.Vector3("+this.mainCamera.up.x+","+this.mainCamera.up.y+","+this.mainCamera.up.z+"),\n"+
			"		target: new THREE.Vector3("+cameraTarget.x+","+cameraTarget.y+","+cameraTarget.z+")\n"+
		  "	},\n"+
		  "	effects: {\n"+
			"		depthOfField: "+this.guiOptions.effects.depthOfField+",\n"+
			"		dofFocalDistance: "+this.guiOptions.depthOfField.focalDistance+"\n"+
		  "	}\n"+
			"}";
		console.log(preset);
	}

	/*
	*   INITIALIZATION
	*/

	this.initializeCommonVars = function() {
		this.id = nextID++;
		this.frameCount = 0;
		this.frameCountTarget = 64;
		this.bufferFlipFlop = true;

		this.fixedSize = (settings.width || settings.height);
		this.width = settings.width || div.offsetParent.offsetWidth;
		this.height = settings.height || div.offsetParent.offsetHeight;
		this.dpr = Math.ceil(window.devicePixelRatio);
		window.addEventListener('resize', this.resize, false);
	}
	this.initializeRenderer = function() {
		this.renderer = new THREE.WebGLRenderer( { alpha: true } );
		this.renderer.shadowMap.enabled = true;
		this.renderer.setSize(this.width, this.height);
		this.renderer.setPixelRatio(this.dpr);
		this.renderer.setClearColor(0x000000, 0);
		this.width = this.width * this.dpr;
		this.height = this.height * this.dpr;
		this.lastRender = new Date().getTime();
	}
	this.initializeTextures = function() {
		// WEBGL_color_buffer_float 														-> WebGL 1 (https://developer.mozilla.org/en-US/docs/Web/API/WEBGL_color_buffer_float)
		// EXT_color_buffer_float & EXT_color_buffer_half_float -> WebGL 2 (https://developer.mozilla.org/en-US/docs/Web/API/EXT_color_buffer_float)
		if (this.renderer.context.getExtension('WEBGL_color_buffer_float') !== null || this.renderer.context.getExtension('EXT_color_buffer_float') !== null || this.getURLParameter('forcefloat')) {
			this.texturePrecision = THREE.FloatType;
			this.log('FLOAT texture precision will be used.');
		} else if (this.renderer.context.getExtension('EXT_color_buffer_half_float') !== null) {
			this.texturePrecision = THREE.HalfFloatType;
			this.log('HALFFLOAT texture precision will be used.');
		} else {
			this.texturePrecision = THREE.UnsignedByteType;
			this.log('UNSIGNED BYTE texture precision will be used.');
		}

		var bufferSettings = {
			minFilter: THREE.LinearFilter,
			magFilter: THREE.LinearFilter,
			format: THREE.RGBAFormat,
			type: this.texturePrecision
		};
		this.firstAccumBuffer = new THREE.WebGLRenderTarget(this.width, this.height, bufferSettings);
		this.secondAccumBuffer = new THREE.WebGLRenderTarget(this.width, this.height, bufferSettings);
		this.newFrameBuffer = new THREE.WebGLRenderTarget(this.width, this.height, bufferSettings);
	}
	this.initializeScenes = function() {
		this.mainCamera = new THREE.PerspectiveCamera(75, this.width / this.height, 0.1, 10000);
		this.mainCamera.position.z = 1;
		this.mixCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
		this.finalCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

		this.mainScene = new THREE.Scene();
		this.mainScene.add(this.mainCamera);

		this.mixScene = new THREE.Scene();
		this.mixScene.add(this.mixCamera);
		this.mixQuad = new THREE.Mesh(new THREE.PlaneBufferGeometry(2, 2), this.mixSceneShaderMaterial);
		this.mixScene.add(this.mixQuad);

		this.finalScene = new THREE.Scene();
		this.finalScene.add(this.finalCamera);
		this.finalQuad = new THREE.Mesh(new THREE.PlaneBufferGeometry(2, 2), new THREE.MeshBasicMaterial( { transparent: true } ));
		this.finalScene.add(this.finalQuad);

		this.light = new THREE.SpotLight(0xffffff, 2, 20);
		this.light.castShadow = true;
		this.light.shadow.mapSize.width = parseInt(this.getURLParameter("shadowMapSize")) || 2048;
		this.light.shadow.mapSize.height = parseInt(this.getURLParameter("shadowMapSize")) || 2048;
		this.light.shadow.camera.near = 0.001;
		this.light.shadow.camera.far = 4000;
		this.light.shadow.camera.fov = 75;
		this.mainScene.add(this.light);

		// screen-aligned quads for accumulating & frame-buffer output

	}
	this.initializeShaders = function() {
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
	}
	this.initializeTrackballControls = function() {
		this.controls = new THREE.TrackballControls(this.mainCamera, this.div);
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
	}
	this.initializeGUI = function() {
		this.gui = new dat.GUI();
		this.gui.width = 300;
		this.guiOptions = {
			"ViewerID(ReadOnly)": this.id,
			mfs: {
				targetFrameCount: 64,
				minimumFrameTime: 0.0,
				renderAlways: false
			},
			effects: {
				antiAliasing: true,
				softShadows: true,
				depthOfField: true
			},
			depthOfField: {
				focalDistance: 0.5
			},
			light: {
				lightIntensity: 2.0,
				followCamera: true
			},
			debug: {
				aaNdcOffsetMultiplier: 1.0,
				ssLightOffsetMultiplier: 0.027,
				dofCoCPointMultiplier: 0.005
			},
			presetFunctions: {}
		};
		this.updateTargetFrameCount = function() {
			var newFrameCountTarget = _this.guiOptions.mfs.targetFrameCount;
			if (newFrameCountTarget != _this.frameCountTarget && newFrameCountTarget > 0) {
				_this.frameCountTarget = newFrameCountTarget;
				_this.requestRender();
			}
		};
		this.updateRenderSettings = function () {
			_this.minimumFrameTime = _this.guiOptions.mfs.minimumFrameTime;
			_this.renderAlways = _this.guiOptions.mfs.renderAlways;
			_this.requestRender();
		}
		this.updateLightMode = function () {
			if (_this.guiOptions.light.followCamera) {
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
			_this.light.intensity = _this.guiOptions.light.lightIntensity;
			_this.requestRender();
		}
		this.updateTargetFrameCount();
		this.updateRenderSettings();
		this.updateLightSettings();
		this.updateLightMode();

		this.gui.add(this.guiOptions, "ViewerID(ReadOnly)");
		this.guiFolders = {};

		this.guiFolders.mfs = this.gui.addFolder("Multi-frame Sampling");
		this.guiFolders.mfs.add(this.guiOptions.mfs, "targetFrameCount", 1, 128).onChange(this.updateTargetFrameCount);
		this.guiFolders.mfs.add(this.guiOptions.mfs, "renderAlways").listen().onChange(this.updateRenderSettings);
		this.guiFolders.mfs.add(this.guiOptions.mfs, "minimumFrameTime", 0, 500).onChange(this.updateRenderSettings);
		this.guiFolders.mfs.open();

		this.guiFolders.effects = this.gui.addFolder("Effects");
		this.guiFolders.effects.add(this.guiOptions.effects, "antiAliasing").onChange(this.requestRender);
		this.guiFolders.effects.add(this.guiOptions.effects, "softShadows").onChange(this.requestRender);
		this.guiFolders.effects.add(this.guiOptions.effects, "depthOfField").listen().onChange(this.requestRender);
		this.guiFolders.effects.open();

		this.guiFolders.presets = this.gui.addFolder("Scene Presets");
		if (window.mfsvPresets) {
			var presetNames = Object.keys(window.mfsvPresets);
			for (var i = 0; i < presetNames.length; i++) {
				(function(presetIndex) {
					_this.guiOptions.presetFunctions[presetNames[presetIndex]] = function() {
						_this.applyScenePreset(window.mfsvPresets[presetNames[presetIndex]]);
					};
				})(i);
				this.guiFolders.presets.add(this.guiOptions.presetFunctions, presetNames[i]);
			}
			this.applyScenePreset(window.mfsvPresets[presetNames[0]]);
		} else {
			this.guiFolders.presets.add({"no presets found": function(){} }, "no presets found");
		}
		this.guiFolders.presets.open();

		this.guiFolders.light = this.gui.addFolder("Light");
		this.guiFolders.light.add(this.guiOptions.light, "followCamera").listen().onChange(this.updateLightMode);
		this.guiFolders.light.add(this.guiOptions.light, "lightIntensity", 1, 5).onChange(this.updateLightSettings);
		this.guiFolders.light.open();

		this.guiFolders.dof = this.gui.addFolder("Depth of Field");
		this.guiFolders.dof.add(this.guiOptions.depthOfField, "focalDistance", 0, 10).listen().onChange(this.requestRender);
		this.guiFolders.dof.open();

		this.guiFolders.debug = this.gui.addFolder("Debugging");
		this.guiFolders.debug.add(this.guiOptions.debug, "aaNdcOffsetMultiplier", 1, 300).onChange(this.requestRender);
		this.guiFolders.debug.add(this.guiOptions.debug, "ssLightOffsetMultiplier", 0, 0.1).onChange(this.requestRender);
		this.guiFolders.debug.add(this.guiOptions.debug, "dofCoCPointMultiplier", 0, 0.02).onChange(this.requestRender);
		if(this.texturePrecision != THREE.FloatType) {
			this.guiFolders.debug.add({"forceFloatTexturePrecision": function() { window.location = window.location.href + "?forcefloat=1"; }}, "forceFloatTexturePrecision");
			this.warn("The renderer is NOT using FLOAT texture precision. Click the 'forceFloat..' button in the Debugging section to force FLOAT texture precision.");
		}
		this.guiFolders.debug.open();
	}
	this.getURLParameter = function(name) {
		return decodeURIComponent((new RegExp('[?|&]' + name + '=' + '([^&;]+?)(&|#|;|$)').exec(location.search) || [null, ''])[1].replace(/\+/g, '%20')) || null;
	}

	this.initialize = function(settings) {
		this.initializeCommonVars();
		this.initializeRenderer();
		this.initializeTextures();
		this.initializeShaders();
		this.initializeScenes();
		this.initializeTrackballControls();
		this.initializeGUI();

		// load and add our object to the scene
		var manager = new THREE.LoadingManager();
		manager.onProgress = function (item, loaded, total) {
			_this.log("Loaded item " + item + " (" + loaded + " of " + total + " objects)");
		};
		manager.onLoad = function () {
			_this.log("Loading finished!");
			_this.animate();
		};

		// remember all materials so we can set uniform values on them (NDC offset for AA, CoC offset for DoF)
		this.allMaterials = new Array;
		if (settings.objPath) {
			this.loadPlainOBJModel(settings.objPath, manager, this.mainScene);
		}
		if (settings.jsonPath) {
			this.loadJSONModel(settings.jsonPath, manager, settings.jsonPath.substring(0, settings.jsonPath.lastIndexOf("/"))+"/textures/", this.mainScene);
		}

		// attach the render-supplied DOM element
		this.div.appendChild(this.renderer.domElement);
	}

	var _this = window.mfsv = this;
	this.div = div;
	this.initialize(settings);
}
