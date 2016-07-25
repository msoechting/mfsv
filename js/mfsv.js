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
		if (_this.frameCount != 0) {
			_this.log("Requesting new frame set!");
			_this.frameCount = 0;
		}
	}
	this.animate = function() {
		_this.controls.update();
		if (_this.frameCount < _this.guiOptions.mfs.targetFrameCount || _this.guiOptions.mfs.renderAlways) {
			_this.render();
		}
		requestAnimationFrame(_this.animate);
	};
	this.render = function() {
		// artificial frame time limitation for multi-sampling presentation
		currentTime = new Date().getTime();
		if ((currentTime - this.lastRender) < this.minimumFrameTime) { return }
		this.lastRender = currentTime;

		var sampleIndex = Math.floor((this.frameCount / this.guiOptions.mfs.targetFrameCount) * this.kernelSize) % this.kernelSize;
		if (this.guiOptions.effects.antiAliasing) {
			var xRand = this.guiOptions.effects.useKernels ? this.aaSamples[sampleIndex].x : Math.random() - 0.5;
			var yRand = this.guiOptions.effects.useKernels ? this.aaSamples[sampleIndex].y : Math.random() - 0.5;
			for (i = 0; i < this.allMaterials.length; i++) {
				this.allMaterials[i].ndcOffset.x = this.guiOptions.debug.aaNdcOffsetMultiplier * 2 * xRand / this.width;
				this.allMaterials[i].ndcOffset.y = this.guiOptions.debug.aaNdcOffsetMultiplier * 2 * yRand / this.height;
			}
		}
		if (this.guiOptions.effects.softShadows) {
			// In the first frame, calculate two arbitrary span vectors describing the plane orthogonal to the light direction vector
			if (this.frameCount == 0) {
				var lightDir = this.light.getWorldDirection().normalize();
				var planeBasis1 = new THREE.Vector3(0, -lightDir.z, lightDir.y).normalize();
				if (planeBasis1.length() < 0.0001) {
					planeBasis1 = new THREE.Vector3(-lightDir.z, 0, lightDir.x).normalize();
					if (planeBasis1.length() < 0.0001) {
						console.warn("this shouldn't happen");
					}
				}
				this.light.planeBasis1 = planeBasis1.clone();
				this.light.planeBasis2 = (lightDir.cross(planeBasis1)).normalize();
			}
			var xRand = this.guiOptions.debug.ssLightOffsetMultiplier * (this.guiOptions.effects.useKernels ? this.ssSamples[sampleIndex].x : Math.random() - 0.5);
			var yRand = this.guiOptions.debug.ssLightOffsetMultiplier * (this.guiOptions.effects.useKernels ? this.ssSamples[sampleIndex].y : Math.random() - 0.5);
			var offset = this.light.planeBasis1.clone().multiplyScalar(xRand).add(this.light.planeBasis2.clone().multiplyScalar(yRand));
			this.light.position.set(this.light.basePosition.x + offset.x, this.light.basePosition.y + offset.y, this.light.basePosition.z + offset.z);
		} else if (this.frameCount == 0) {
			this.light.position.copy(this.light.basePosition);
		}
		if (this.guiOptions.effects.depthOfField) {
			var xRand = this.guiOptions.effects.useKernels ? this.dofSamples[sampleIndex].x : 2 * (Math.random() - 0.5);
			var yRand = this.guiOptions.effects.useKernels ? this.dofSamples[sampleIndex].y : 2 * (Math.random() - 0.5);
			for (i = 0; i < this.allMaterials.length; i++) {
				this.allMaterials[i].focalDistance = this.guiOptions.depthOfField.focalDistance;
				this.allMaterials[i].cocPoint.x = this.guiOptions.debug.dofCoCPointMultiplier * xRand;
				this.allMaterials[i].cocPoint.y = this.guiOptions.debug.dofCoCPointMultiplier * yRand;
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
		this.guiOptions.depthOfField.focalDistance = preset.effects.dofFocalDistance || this.guiOptions.depthOfField.focalDistance;
		this.guiOptions.effects.depthOfField = preset.effects.depthOfField;
		this.guiOptions.light.lightIntensity = preset.light.intensity || this.guiOptions.light.lightIntensity;
		this.light.intensity = this.guiOptions.light.lightIntensity;
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
			"		target: new THREE.Vector3("+lightTarget.x+","+lightTarget.y+","+lightTarget.z+"),\n"+
			"		intensity: "+this.guiOptions.light.lightIntensity+"\n"+
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
		this.div.appendChild(this.renderer.domElement);
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
	this.initializeKernels = function() {
		this.kernelSize = 128;
		this.aaSamples = {"0":{"x":0,"y":0},"1":{"x":0.0455999,"y":0.0627589},"2":{"x":-0.040639,"y":-0.0630303},"3":{"x":0.275167,"y":0.313064},"4":{"x":0.163567,"y":-0.223061},"5":{"x":-0.105152,"y":0.418805},"6":{"x":-0.369754,"y":-0.222205},"7":{"x":0.0258204,"y":0.372556},"8":{"x":0.0523323,"y":-0.410842},"9":{"x":-0.149198,"y":-0.27101},"10":{"x":0.0438074,"y":-0.19543},"11":{"x":0.31052,"y":-0.184284},"12":{"x":-0.28602,"y":0.0749581},"13":{"x":0.253195,"y":0.239635},"14":{"x":-0.264823,"y":-0.191367},"15":{"x":0.472274,"y":-0.1658},"16":{"x":-0.339341,"y":0.132306},"17":{"x":-0.403058,"y":0.329614},"18":{"x":-0.362423,"y":0.0561563},"19":{"x":-0.3513,"y":-0.341235},"20":{"x":-0.214469,"y":0.163312},"21":{"x":0.00873005,"y":0.145234},"22":{"x":0.237003,"y":0.133996},"23":{"x":0.0285602,"y":0.229872},"24":{"x":-0.0111734,"y":0.306371},"25":{"x":0.192933,"y":0.384164},"26":{"x":-0.0434103,"y":-0.198939},"27":{"x":-0.276445,"y":-0.420571},"28":{"x":-0.0411673,"y":-0.475625},"29":{"x":-0.408604,"y":-0.122778},"30":{"x":-0.357854,"y":-0.42491},"31":{"x":0.463607,"y":-0.251593},"32":{"x":-0.179295,"y":-0.339942},"33":{"x":0.115016,"y":0.283274},"34":{"x":-0.348139,"y":0.379873},"35":{"x":-0.217762,"y":-0.486189},"36":{"x":-0.0995732,"y":-0.338618},"37":{"x":-0.126924,"y":-0.451365},"38":{"x":-0.030557,"y":0.0809392},"39":{"x":0.297544,"y":-0.460182},"40":{"x":-0.117896,"y":-0.168102},"41":{"x":-0.327808,"y":-0.148703},"42":{"x":0.481156,"y":0.018562},"43":{"x":-0.0701305,"y":-0.269272},"44":{"x":0.13812,"y":-0.485886},"45":{"x":-0.295886,"y":-0.0139798},"46":{"x":-0.0634406,"y":-0.404126},"47":{"x":0.325802,"y":-0.287541},"48":{"x":0.142144,"y":-0.411581},"49":{"x":0.11873,"y":-0.0917304},"50":{"x":0.161714,"y":-0.299301},"51":{"x":0.321734,"y":-0.0320698},"52":{"x":-0.253112,"y":0.229208},"53":{"x":0.113379,"y":-0.166825},"54":{"x":-0.189322,"y":-0.197885},"55":{"x":0.221664,"y":0.0446832},"56":{"x":-0.276668,"y":-0.332699},"57":{"x":0.0732478,"y":0.464214},"58":{"x":0.39712,"y":-0.16936},"59":{"x":0.418188,"y":0.0852386},"60":{"x":-0.40653,"y":-0.0291163},"61":{"x":-0.186692,"y":0.422885},"62":{"x":0.385107,"y":0.208932},"63":{"x":-0.182174,"y":0.346605},"64":{"x":-0.496163,"y":0.324139},"65":{"x":-0.0101327,"y":-0.131725},"66":{"x":-0.204935,"y":0.0808039},"67":{"x":-0.265373,"y":-0.0996427},"68":{"x":0.455714,"y":-0.325598},"69":{"x":0.321493,"y":0.168923},"70":{"x":-0.443425,"y":0.253156},"71":{"x":0.361446,"y":-0.100536},"72":{"x":0.354018,"y":0.398852},"73":{"x":-0.428067,"y":0.401113},"74":{"x":0.474756,"y":-0.40363},"75":{"x":0.472121,"y":-0.0726627},"76":{"x":-0.0198126,"y":0.432226},"77":{"x":0.263317,"y":-0.122908},"78":{"x":0.359342,"y":0.0386087},"79":{"x":-0.011451,"y":-0.337924},"80":{"x":-0.270295,"y":0.302504},"81":{"x":-0.221091,"y":-0.039561},"82":{"x":0.161446,"y":0.129312},"83":{"x":0.235363,"y":-0.244583},"84":{"x":0.247535,"y":-0.0366143},"85":{"x":-0.140571,"y":0.148567},"86":{"x":-0.372336,"y":0.199245},"87":{"x":0.216587,"y":-0.393452},"88":{"x":0.201681,"y":0.298512},"89":{"x":-0.0899325,"y":0.257958},"90":{"x":0.0836158,"y":-0.34289},"91":{"x":0.0880759,"y":-0.266588},"92":{"x":-0.421823,"y":0.143495},"93":{"x":0.25239,"y":-0.317213},"94":{"x":-0.0426258,"y":0.200417},"95":{"x":-0.348266,"y":-0.0771887},"96":{"x":-0.340706,"y":0.275021},"97":{"x":0.0842856,"y":-0.00119337},"98":{"x":0.187388,"y":0.204935},"99":{"x":-0.107812,"y":0.341765},"100":{"x":0.421969,"y":0.368125},"101":{"x":0.144983,"y":0.0425125},"102":{"x":-0.301886,"y":-0.495799},"103":{"x":-0.0721817,"y":0.0183855},"104":{"x":0.426476,"y":0.273535},"105":{"x":0.382596,"y":-0.34193},"106":{"x":0.385037,"y":-0.493022},"107":{"x":-0.223744,"y":-0.265099},"108":{"x":0.300299,"y":0.0933535},"109":{"x":-0.12681,"y":-0.0876142},"110":{"x":-0.197231,"y":-0.412118},"111":{"x":-0.125896,"y":0.0743554},"112":{"x":-0.169605,"y":0.244753},"113":{"x":-0.139548,"y":-0.0143215},"114":{"x":-0.301742,"y":-0.257666},"115":{"x":0.278308,"y":0.391332},"116":{"x":-0.455187,"y":0.0755041},"117":{"x":0.111196,"y":0.202869},"118":{"x":0.0453486,"y":-0.0650575},"119":{"x":0.188111,"y":-0.131133},"120":{"x":0.355095,"y":-0.411596},"121":{"x":0.109199,"y":0.381526},"122":{"x":-0.493943,"y":0.164517},"123":{"x":0.348836,"y":0.29635},"124":{"x":0.00391221,"y":-0.259841},"125":{"x":0.416082,"y":-0.0231607},"126":{"x":0.0850766,"y":0.128494},"127":{"x":0.170936,"y":-0.0300264}};
		this.dofSamples = {"0":{"x":0,"y":0},"1":{"x":-0.0659782,"y":0.135983},"2":{"x":-0.149216,"y":-0.0326158},"3":{"x":0.150394,"y":0.0294912},"4":{"x":0.0931628,"y":-0.122279},"5":{"x":-0.0876002,"y":-0.17351},"6":{"x":-0.228107,"y":0.13508},"7":{"x":0.0788797,"y":-0.271237},"8":{"x":0.0769844,"y":0.280434},"9":{"x":0.292674,"y":-0.0562533},"10":{"x":0.227985,"y":0.195378},"11":{"x":-0.299113,"y":-0.0284835},"12":{"x":-0.0783654,"y":0.295617},"13":{"x":-0.0937948,"y":-0.328349},"14":{"x":-0.257941,"y":-0.251908},"15":{"x":0.348282,"y":-0.206455},"16":{"x":0.399998,"y":0.12553},"17":{"x":0.258767,"y":-0.332667},"18":{"x":0.108615,"y":-0.425214},"19":{"x":-0.0285077,"y":0.439888},"20":{"x":-0.425196,"y":-0.119524},"21":{"x":-0.440686,"y":0.0443224},"22":{"x":-0.239056,"y":0.372901},"23":{"x":0.179789,"y":0.419953},"24":{"x":-0.448681,"y":0.195752},"25":{"x":0.489801,"y":-0.0472435},"26":{"x":-0.00890917,"y":-0.517107},"27":{"x":-0.389536,"y":0.344102},"28":{"x":-0.325395,"y":-0.413868},"29":{"x":-0.192497,"y":-0.492043},"30":{"x":0.409429,"y":-0.35002},"31":{"x":0.450845,"y":0.303207},"32":{"x":0.504716,"y":-0.218256},"33":{"x":0.260447,"y":-0.49457},"34":{"x":0.363908,"y":0.427977},"35":{"x":-0.475851,"y":-0.335422},"36":{"x":-0.573336,"y":0.112941},"37":{"x":0.587611,"y":0.0715598},"38":{"x":-0.0272151,"y":0.599147},"39":{"x":0.115303,"y":-0.601085},"40":{"x":0.138821,"y":0.59677},"41":{"x":-0.615767,"y":-0.0319461},"42":{"x":0.582839,"y":0.227719},"43":{"x":-0.246664,"y":0.5903},"44":{"x":-0.328513,"y":-0.568808},"45":{"x":-0.0985911,"y":-0.655395},"46":{"x":0.66276,"y":-0.0872356},"47":{"x":0.332711,"y":0.587837},"48":{"x":-0.606743,"y":0.327999},"49":{"x":-0.414207,"y":0.552589},"50":{"x":-0.641241,"y":-0.306327},"51":{"x":0.313194,"y":-0.647426},"52":{"x":0.518138,"y":-0.499221},"53":{"x":-0.143015,"y":0.707494},"54":{"x":0.639188,"y":-0.338664},"55":{"x":0.486891,"y":0.539656},"56":{"x":-0.506942,"y":-0.522914},"57":{"x":-0.549676,"y":0.489175},"58":{"x":-0.732593,"y":0.0698825},"59":{"x":-0.241921,"y":-0.704289},"60":{"x":0.72337,"y":0.176953},"61":{"x":0.649792,"y":0.382508},"62":{"x":0.278698,"y":0.742102},"63":{"x":0.20336,"y":-0.766607},"64":{"x":-0.00156218,"y":-0.797167},"65":{"x":-0.442408,"y":-0.666203},"66":{"x":-0.771639,"y":0.21398},"67":{"x":0.485811,"y":-0.654934},"68":{"x":-0.664349,"y":-0.475452},"69":{"x":0.447687,"y":0.702483},"70":{"x":0.0631341,"y":0.838599},"71":{"x":0.8464,"y":0.0517569},"72":{"x":0.809966,"y":-0.254897},"73":{"x":-0.33348,"y":0.781},"74":{"x":-0.839132,"y":-0.152069},"75":{"x":-0.791261,"y":-0.329474},"76":{"x":0.640371,"y":0.582075},"77":{"x":0.805021,"y":0.321426},"78":{"x":-0.088765,"y":0.862981},"79":{"x":-0.722996,"y":0.501125},"80":{"x":0.383386,"y":-0.806742},"81":{"x":-0.344414,"y":-0.824374},"82":{"x":-0.610596,"y":-0.655162},"83":{"x":0.12887,"y":-0.899334},"84":{"x":0.218742,"y":0.893183},"85":{"x":0.739703,"y":-0.54706},"86":{"x":-0.191162,"y":-0.910505},"87":{"x":-0.480932,"y":0.802175},"88":{"x":-0.936885,"y":-0.00381225},"89":{"x":0.834698,"y":-0.426071},"90":{"x":0.923426,"y":0.179395},"91":{"x":-0.92624,"y":0.176724},"92":{"x":0.942337,"y":-0.171103},"93":{"x":-0.495702,"y":-0.821743},"94":{"x":0.282034,"y":-0.91779},"95":{"x":-0.041346,"y":-0.96063},"96":{"x":-0.904461,"y":0.32821},"97":{"x":-0.804383,"y":-0.531143},"98":{"x":-0.284086,"y":0.926004},"99":{"x":0.601837,"y":-0.765499},"100":{"x":0.477171,"y":0.85094},"101":{"x":-0.626311,"y":0.753656},"102":{"x":-0.944751,"y":-0.279544},"103":{"x":0.81613,"y":0.564538},"104":{"x":-0.870799,"y":0.541352},"105":{"x":0.936173,"y":0.433356},"106":{"x":0.683583,"y":0.781678},"107":{"x":-0.794195,"y":0.672771},"108":{"x":-0.432021,"y":-0.958854},"109":{"x":0.534867,"y":-0.91028},"110":{"x":-0.700432,"y":-0.796268},"111":{"x":0.848664,"y":-0.648369},"112":{"x":0.99682,"y":-0.433896},"113":{"x":-0.588096,"y":0.917146},"114":{"x":0.742937,"y":-0.81383},"115":{"x":0.843455,"y":0.732197},"116":{"x":-0.618697,"y":-0.935538},"117":{"x":0.967029,"y":0.617888},"118":{"x":-0.859297,"y":0.808948},"119":{"x":0.9971,"y":-0.634057},"120":{"x":-0.912451,"y":-0.755161},"121":{"x":0.672828,"y":-0.977903},"122":{"x":0.891659,"y":-0.79117},"123":{"x":-0.751811,"y":0.932026},"124":{"x":-0.82559,"y":-0.892785},"125":{"x":0.82862,"y":-0.977495},"126":{"x":-0.989464,"y":-0.903093},"127":{"x":-0.97325,"y":0.936454}};
		this.ssSamples = this.dofSamples;
	}
	this.initializeTrackballControls = function() {
		this.controls = new THREE.TrackballControls(this.mainCamera, this.renderer.domElement);
		this.controls.addEventListener('change', this.requestRender);
		this.controls.target.set(0, 0, 0);
		this.controls.rotateSpeed = 10;
		this.controls.zoomSpeed = 3;
		this.controls.panSpeed = 4;
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
				depthOfField: true,
				useKernels: true
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
			_this.guiOptions.mfs.targetFrameCount = Math.floor(_this.guiOptions.mfs.targetFrameCount);
			_this.requestRender();
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
		this.guiFolders.effects.add(this.guiOptions.effects, "useKernels").onChange(this.requestRender);
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
			this.guiFolders.presets.add({ "no presets found": function(){} }, "no presets found");
		}
		this.guiFolders.presets.open();

		this.guiFolders.light = this.gui.addFolder("Light");
		this.guiFolders.light.add(this.guiOptions.light, "followCamera").listen().onChange(this.updateLightMode);
		this.guiFolders.light.add(this.guiOptions.light, "lightIntensity", 1, 5).listen().onChange(this.updateLightSettings);
		this.guiFolders.light.open();

		this.guiFolders.dof = this.gui.addFolder("Depth of Field");
		this.guiFolders.dof.add(this.guiOptions.depthOfField, "focalDistance", 0, 7).listen().onChange(this.requestRender);
		this.guiFolders.dof.open();

		this.guiFolders.debug = this.gui.addFolder("Debugging");
		this.guiFolders.debug.add(this.guiOptions.debug, "aaNdcOffsetMultiplier", 1, 300).onChange(this.requestRender);
		this.guiFolders.debug.add(this.guiOptions.debug, "ssLightOffsetMultiplier", 0, 0.1).onChange(this.requestRender);
		this.guiFolders.debug.add(this.guiOptions.debug, "dofCoCPointMultiplier", 0, 0.02).onChange(this.requestRender);
		if (this.texturePrecision != THREE.FloatType) {
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
		this.initializeKernels();
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

		// remember all materials so we can set uniform values on them later (NDC offset for AA, CoC offset for DoF)
		this.allMaterials = new Array;
		if (settings.objPath) {
			this.loadPlainOBJModel(settings.objPath, manager, this.mainScene);
		}
		if (settings.jsonPath) {
			this.loadJSONModel(settings.jsonPath, manager, settings.jsonPath.substring(0, settings.jsonPath.lastIndexOf("/"))+"/textures/", this.mainScene);
		}
	}

	var _this = window.mfsv = this;
	this.div = div;
	this.initialize(settings);
}
