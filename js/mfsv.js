var nextID = 1;

window.onload = function() {
	var divs = document.getElementsByClassName("mfsviewer");
	for (var i = 0; i < divs.length; i++) {
		new MFSViewer(divs[i], { objPath: divs[i].getAttribute("objPath") });
	}
}

function MFSViewer(div, settings) {
	var myself = this;
	window.mfsv = this;

	this.animate = function() {
		myself.controls.update();
		if (myself.frameCount < myself.frameCountTarget || myself.renderAlways) {
			myself.render();
			//myself.log("Rendered " + myself.frameCount + "/" + myself.frameCountTarget + " frames");
		}
		requestAnimationFrame(myself.animate);
	};

	this.log = function(logContent) {
		console.log("[MFSViewer #"+myself.id+"]", logContent);
	}

	this.requestRender = function() {
		myself.log("Requesting new frame set!");
		myself.frameCount = 0;
	}

	this.render = function() {
		// artificial frame time limitation for multi-sampling presentation
		currentTime = new Date().getTime();
		if ((currentTime - this.lastRender) < this.minimumFrameTime) { return }
		this.lastRender = currentTime;

		// set NDC offsets if AA is enabled
		if (this.mainSceneShaderMaterial.uniforms.antiAliasing.value) {
			var xRand = Math.random() - 0.5;
			var yRand = Math.random() - 0.5;
			this.mainSceneShaderMaterial.uniforms.aaNdcOffset.value.x = 2 * xRand / (this.width);
			this.mainSceneShaderMaterial.uniforms.aaNdcOffset.value.y = 2 * yRand / (this.height);
		}

		// generate new frame from main scene
		this.renderer.render(this.mainScene, this.mainCamera, this.newFrameBuffer);

		// mix our previously accumulated image with our new frame in the mix scene
		this.mixSceneShaderMaterial.uniforms.newFrame.value = this.newFrameBuffer.texture;
		this.mixSceneShaderMaterial.uniforms.lastFrame.value = this.bufferFlipFlop ? this.secondAccumBuffer.texture : this.firstAccumBuffer.texture;
		this.mixSceneShaderMaterial.uniforms.weight.value = this.frameCount / (this.frameCount + 1);
		this.renderer.render(this.mixScene, this.mixCamera, this.bufferFlipFlop ? this.firstAccumBuffer : this.secondAccumBuffer, false);

		// render our new accumulated image to our final scene
		this.finalQuad.material.map = !this.bufferFlipFlop ? this.secondAccumBuffer.texture : this.firstAccumBuffer.texture;
		this.renderer.render(this.finalScene, this.finalCamera);

		this.bufferFlipFlop = !this.bufferFlipFlop;
		this.frameCount++;
    evalTick();
	}

	this.resize = function() {
		if (myself.fixedSize) {
				return;
		}
		var w = myself.div.offsetParent.offsetWidth, h = myself.div.offsetParent.offsetHeight;
		myself.renderer.setSize(w, h);
		myself.dpr = window.devicePixelRatio;
		w *= myself.dpr;
		h *= myself.dpr;
		myself.mainCamera.aspect = w / h;
		myself.mainCamera.updateProjectionMatrix();
		myself.firstAccumBuffer.setSize(w, h);
		myself.secondAccumBuffer.setSize(w, h);
		myself.newFrameBuffer.setSize(w, h);
		myself.mixSceneShaderMaterial.uniforms.viewport.value = new THREE.Vector2(w, h);
		myself.width = w;
		myself.height = h;
		myself.requestRender();
	}

	// set width & height
	this.fixedSize = !(settings == undefined || settings.width == undefined || settings.height == undefined);
	this.width = settings.width ? settings.width : div.offsetParent.offsetWidth;
	this.height = settings.height ? settings.height : div.offsetParent.offsetHeight;
	window.addEventListener('resize', this.resize, false);
	this.dpr = (window.devicePixelRatio > 0) ? window.devicePixelRatio : 1;

	// misc vars
	this.frameCount = 0;
	this.frameCountTarget = 64;
	this.bufferFlipFlop = true;
	this.id = nextID++;

	// prepare renderer
	this.renderer = new THREE.WebGLRenderer( { alpha: true } );
	this.renderer.setSize(this.width, this.height);
	this.renderer.setPixelRatio(this.dpr);
	this.width = this.width * this.dpr;
	this.height = this.height * this.dpr;
	this.renderer.setClearColor(0x000000, 0);
	this.lastRender = new Date().getTime();
	this.renderAlways = false;

	// DETECT TEXTURE PRECISION
	// .getExtension activates the extension
	// 		WEBGL_color_buffer_float -> WebGL 1 (https://developer.mozilla.org/en-US/docs/Web/API/WEBGL_color_buffer_float)
	// 		EXT_color_buffer_float & EXT_color_buffer_half_float -> WebGL 2 (https://developer.mozilla.org/en-US/docs/Web/API/EXT_color_buffer_float)
	var texturePrecision;
	if (this.renderer.context.getExtension('WEBGL_color_buffer_float') !== null || this.renderer.context.getExtension('EXT_color_buffer_float') !== null) {
		texturePrecision = THREE.FloatType;
		this.log('FLOAT texture precision supported and will be used.');
	} else if (this.renderer.context.getExtension('EXT_color_buffer_half_float') !== null) {
		texturePrecision = THREE.HalfFloatType;
		this.log('HALFFLOAT texture precision supported and will be used.');
	} else {
		texturePrecision = THREE.UnsignedByteType;
		this.log('UNSIGNED BYTE texture precision will be used.');
	}

	// set up textures
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
	var mainSceneVertexShader = " \n"+
		"// switch on high precision floats \n"+
		"#ifdef GL_ES \n"+
		"precision highp float; \n"+
		"#endif \n"+
 		"\n"+
		"uniform bool antiAliasing; \n"+
		"uniform vec2 aaNdcOffset; \n"+
 		"\n"+
		"varying vec3 vNormal; \n"+
		"varying vec4 vPosition; \n"+
 		"\n"+
		"void main() { \n"+
		"		vNormal = normal; \n"+
		"		vPosition = modelMatrix * vec4(position, 1.0); \n"+
		"		vPosition *= vPosition.w; \n"+
		"		vec4 ndcVertex = projectionMatrix * modelViewMatrix * vec4(position, 1.0); \n"+
		"		if (antiAliasing) { \n"+
		"			ndcVertex.xy += aaNdcOffset * ndcVertex.w; \n"+
		"		} \n"+
		"		gl_Position = ndcVertex; \n"+
		"}";
	var mainSceneFragmentShader = " \n"+
		"// switch on high precision floats \n"+
		"#ifdef GL_ES \n"+
		"precision highp float; \n"+
		"#endif \n"+
 		"\n"+
		"uniform vec3 ambientColor; \n"+
		"uniform vec3 diffuseColor; \n"+
		"uniform vec3 specularColor; \n"+
		"uniform float shininess; \n"+
		"uniform vec3 lightPosition; \n"+
 		"\n"+
		"varying vec3 vNormal; \n"+
		"varying vec4 vPosition; \n"+
 		"\n"+
		"void main() { \n"+
		"		vec3 L = normalize(lightPosition - vPosition.xyz); \n"+
 		"		\n"+
		"		float lambert = dot(vNormal, L); \n"+
		"		float specular = 0.0; \n"+
		"		if(lambert > 0.0) { \n"+
		"			vec3 R = reflect(-L, vNormal); \n"+
		"			vec3 V = normalize(-vPosition.xyz); \n"+
		"			float specAngle = max(dot(R, V), 0.0); \n"+
		"			specular = pow(specAngle, shininess); \n"+
		"		} \n"+
		"		gl_FragColor = vec4(vec3(ambientColor + diffuseColor * lambert + specularColor * specular), 1.0); \n"+
		"}";
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

	this.mainSceneShaderMaterial = new THREE.ShaderMaterial({
		uniforms: {
			antiAliasing: { value: settings.antiAliasing != undefined ? settings.antiAliasing : true },
			aaNdcOffset: { value: new THREE.Vector2(0.0, 0.0) },
			ambientColor: { value: new THREE.Vector3(0.0, 0.0, 0.0) },
			diffuseColor: { value: new THREE.Vector3(1.0, 1.0, 1.0) },
			specularColor: { value: new THREE.Vector3(0.5, 0.5, 0.5) },
			shininess: { value: 4 },
			lightPosition: { value: this.mainCamera.position }
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

	var loader = new THREE.OBJLoader(manager);
	loader.load(settings.objPath, function (object) {
		object.traverse(function(child) {
			if (child instanceof THREE.Mesh) {
				child.material = myself.mainSceneShaderMaterial;
			}
		} );
		myself.mainScene.add(object);
	} );

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
		"ViewerID(ReadOnly)": this.id,
		targetFrameCount: "64",
		antiAliasing: this.mainSceneShaderMaterial.uniforms.antiAliasing.value,
		minimumFrameTime: 0.0,
		"ignoreTargetFrameCount": this.renderAlways
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
		myself.minimumFrameTime = guiOptions.minimumFrameTime;
		myself.renderAlways = guiOptions["ignoreTargetFrameCount"];
		myself.requestRender();
	}
	updateTargetFrameCount();
	updateRenderSettings();
	this.gui.add(guiOptions, "ViewerID(ReadOnly)");
	this.gui.add(guiOptions, "targetFrameCount").onChange(updateTargetFrameCount);
	this.gui.add(guiOptions, "ignoreTargetFrameCount").onChange(updateRenderSettings);
	this.gui.add(guiOptions, "antiAliasing").onChange(updateRenderSettings);
	this.gui.add(guiOptions, "minimumFrameTime", 0, 500).onChange(updateRenderSettings);
}
