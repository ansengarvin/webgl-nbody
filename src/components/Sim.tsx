import { useEffect, useRef } from "react";
import {
    BloomProgramInfo,
    CamlightProgramInfo,
    GaussianBlurProgramInfo,
    SimpleProgramInfo,
    StarlightProgramInfo,
    TexQuadProgramInfo,
} from "../lib/webGL/shaderPrograms";
import { initShaderProgram } from "../lib/webGL/shaders";
import { initBuffers } from "../lib/webGL/buffers";
import { getModel, Model } from "../lib/gltf/model";
import { Universe } from "../lib/universe/universe";
import { Camera } from "../lib/webGL/camera";
import styled from "@emotion/styled";

// Note: Vite allows us to import a raw file. This is okay in this instance, since glsl files are just text.
import fragSimple from "../assets/shaders/simple/simple.frag.glsl?raw";
import vertSimple from "../assets/shaders/simple/simple.vert.glsl?raw";
import fragLightGlobal from "../assets/shaders/camlight/camlight.frag.glsl?raw";
import vertLightGlobal from "../assets/shaders/camlight/camlight.vert.glsl?raw";
import fragLightStars from "../assets/shaders/starlight/starlight.frag.glsl?raw";
import vertLightStars from "../assets/shaders/starlight/starlight.vert.glsl?raw";
import fragTexQuad from "../assets/shaders/texQuad/texQuad.frag.glsl?raw";
import vertTexQuad from "../assets/shaders/texQuad/texQuad.vert.glsl?raw";
import fragGaussianBlur from "../assets/shaders/gaussianBlur/gaussianBlur.frag.glsl?raw";
import vertGaussianBlur from "../assets/shaders/gaussianBlur/gaussianBlur.vert.glsl?raw";
import fragBloom from "../assets/shaders/bloom/bloom.frag.glsl?raw";
import vertBloom from "../assets/shaders/bloom/bloom.vert.glsl?raw";

import { mat4, vec4 } from "gl-matrix";
import {
    setNormalAttribute,
    setPositionAttribute,
    setPositionAttribute2D,
    setTexCoordAttribute,
} from "../lib/webGL/attributes";
import { useMouseControls } from "../hooks/useMouseControls";
import { useTouchControls } from "../hooks/useTouchControls";
import { calculateUniformVectors } from "./DebugStats";
import { LeaderboardBody } from "./Leaderboard";
import { useDispatch, useSelector } from "react-redux";
import { RootState } from "../redux/store";
import { getCirclePositions } from "../lib/webGL/shapes";
import { SolarSystemDistanceAU } from "../lib/defines/solarSystem";
import { CircleType } from "../redux/controlsSlice";

const ticksPerSecond = 60;
const secondsPerTick = 1 / ticksPerSecond;
const cameraSensititivy = 0.01;
const fieldOfView = (45 * Math.PI) / 180; // in radians
const zNear = 0.1;
const zFar = 100.0;
const NUM_CIRCLE_VERTICES = 100;

interface SimProps {
    // leaderboard information
    setLeaderboardBodies: React.Dispatch<React.SetStateAction<Array<LeaderboardBody>>>;
}

export function Sim(props: SimProps) {
    const { setLeaderboardBodies } = props;

    const settings = useSelector((state: RootState) => state.universeSettings);
    const dispatch = useDispatch();

    /*
        The camera and universe classes do not need ot be rerendered ever
    */
    const cameraRef = useRef<Camera>(new Camera(0, 0, 0, 0, 0, -20));
    const { handleMouseWheel, handleMouseDown, handleMouseMove, handleMouseUp } = useMouseControls(
        cameraRef,
        cameraSensititivy,
    );
    const { handleTouchStart, handleTouchMove, handleTouchEnd } = useTouchControls(cameraRef, cameraSensititivy);
    const universe = useRef<Universe>(new Universe(settings));

    /*
        WebGL and render() live outside of the react lifecycle. Therefore, they cannot access the most recent data from
        states or selectors. To work around this, I convert them into refs.
    */
    // User-set debug settings
    const circleType = useSelector((state: RootState) => state.controls.circleType);
    const circleTypeRef = useRef(circleType);
    useEffect(() => {
        circleTypeRef.current = circleType;
    }, [circleType]);

    // User-set graphics settings
    const graphicsSettings = useSelector((state: RootState) => state.graphicsSettings);
    const starLightRef = useRef(graphicsSettings.starLight);
    useEffect(() => {
        starLightRef.current = graphicsSettings.starLight;
    }, [graphicsSettings.starLight]);

    // User controls
    const resetSim = useSelector((state: RootState) => state.controls.resetSim);
    const resetCam = useSelector((state: RootState) => state.controls.resetCam);

    const paused = useSelector((state: RootState) => state.controls.paused);
    const pausedRef = useRef(paused);
    useEffect(() => {
        pausedRef.current = paused;
    }, [paused]);

    const bodyFollowed = useSelector((state: RootState) => state.controls.bodyFollowed);
    const bodyFollowedRef = useRef(bodyFollowed);
    useEffect(() => {
        setLeaderboardBodies(universe.current.getActiveBodies(bodyFollowed));
        bodyFollowedRef.current = bodyFollowed;
    }, [bodyFollowed]);

    useEffect(() => {
        universe.current = new Universe(settings);
        cameraRef.current.setAll(0, 0, 0, 0, 0, -20);
        dispatch({ type: "controls/unsetBodyFollowed", payload: 0 });
        setLeaderboardBodies(universe.current.getActiveBodies(-1));
        dispatch({ type: "information/setNumActiveBodies", payload: universe.current.numActive });
        dispatch({ type: "information/setNumStars", payload: universe.current.getNumStars() });
    }, [settings]);

    useEffect(() => {
        cameraRef.current.setAll(0, 0, 0, 0, 0, -20);
        dispatch({ type: "controls/unsetBodyFollowed", payload: 0 });
        universe.current.reset();
        setLeaderboardBodies(universe.current.getActiveBodies(-1));
        dispatch({ type: "information/setNumActiveBodies", payload: universe.current.numActive });
        dispatch({ type: "information/setNumStars", payload: universe.current.getNumStars() });
    }, [resetSim]);

    useEffect(() => {
        cameraRef.current.setTarget(0, 0, 0);
    }, [resetCam]);
    /*
        Set up WebGL Renderer
    */
    const initializedRef = useRef(false);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    useEffect(() => {
        if (initializedRef.current) {
            return;
        } else {
            initializedRef.current = true;
        }
        const canvas = canvasRef.current;
        if (!canvas) {
            console.error("Canvas element not found");
            return;
        }

        const gl = canvas.getContext("webgl2", { antialias: false });
        if (!gl) {
            alert("Unable to initialize WebGL.");
            return;
        }

        const initialize = async () => {
            // Set sorted universe parameters initially
            setLeaderboardBodies(universe.current.getActiveBodies(bodyFollowed));

            // Enable necessary openGL extensions and store results
            const rgba32fSupported = gl.getExtension("EXT_color_buffer_float") != null;
            const rgba16fSupported = gl.getExtension("EXT_color_buffer_half_float") !== null;
            const oesTextureFloatLinearSupported = gl.getExtension("OES_texture_float_linear") !== null;
            const oesTextureHalfFloatLinearSupported = gl.getExtension("OES_texture_half_float_linear") !== null;

            // Set unchanging webGL debug text
            dispatch({ type: "information/setNumActiveBodies", payload: universe.current.numActive });
            dispatch({
                type: "information/setMaxVertexUniformVectors",
                payload: gl.getParameter(gl.MAX_VERTEX_UNIFORM_VECTORS),
            });
            dispatch({
                type: "information/setMaxFragmentUniformVectors",
                payload: gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS),
            });
            dispatch({
                type: "information/setMaxUniformBufferBindingPoints",
                payload: gl.getParameter(gl.MAX_UNIFORM_BUFFER_BINDINGS),
            });
            dispatch({ type: "information/setMaxSamples", payload: gl.getParameter(gl.MAX_SAMPLES) });
            dispatch({
                type: "information/setRgba32fSupported",
                payload: rgba32fSupported,
            });
            dispatch({
                type: "information/setRgba16fSupported",
                payload: rgba16fSupported,
            });
            dispatch({
                type: "information/setOesFloatLinearSupported",
                payload: oesTextureFloatLinearSupported,
            });
            dispatch({
                type: "information/setOesHalfFloatLinearSupported",
                payload: oesTextureHalfFloatLinearSupported,
            });

            /*
                Initialize all shader programs
            */
            const simpleShaderProgram = initShaderProgram(gl, vertSimple, fragSimple);
            if (!simpleShaderProgram) {
                console.error("Failed to initialize shader program");
                return;
            }
            const simpleProgramInfo: SimpleProgramInfo = {
                program: simpleShaderProgram,
                attribLocations: {
                    vertexPosition: gl.getAttribLocation(simpleShaderProgram, "aVertexPosition"),
                    vertexNormal: gl.getAttribLocation(simpleShaderProgram, "aVertexNormal"),
                    texCoords: gl.getAttribLocation(simpleShaderProgram, "aTexCoords"),
                },
                uniformLocations: {
                    projectionMatrix: gl.getUniformLocation(simpleShaderProgram, "uProjectionMatrix"),
                    modelViewMatrix: gl.getUniformLocation(simpleShaderProgram, "uModelViewMatrix"),
                    uFragColor: gl.getUniformLocation(simpleShaderProgram, "uFragColor"),
                },
            };

            const camlightShaderProgram = initShaderProgram(gl, vertLightGlobal, fragLightGlobal);
            if (!camlightShaderProgram) {
                console.error("Failed to initialize camera light shader");
                return;
            }
            const camlightProgramInfo: CamlightProgramInfo = {
                program: camlightShaderProgram,
                attribLocations: {
                    vertexPosition: gl.getAttribLocation(camlightShaderProgram, "aVertexPosition"),
                    vertexNormal: gl.getAttribLocation(camlightShaderProgram, "aVertexNormal"),
                    texCoords: gl.getAttribLocation(camlightShaderProgram, "aTexCoords"),
                },
                uniformLocations: {
                    projectionMatrix: gl.getUniformLocation(camlightShaderProgram, "uProjectionMatrix"),
                    modelViewMatrix: gl.getUniformLocation(camlightShaderProgram, "uModelViewMatrix"),
                    normalMatrix: gl.getUniformLocation(camlightShaderProgram, "uNormalMatrix"),
                    uFragColor: gl.getUniformLocation(camlightShaderProgram, "uFragColor"),
                },
            };

            const starlightShaderProgram = initShaderProgram(gl, vertLightStars, fragLightStars);
            if (!starlightShaderProgram) {
                console.error("Failed to initialize shader program");
                return;
            }
            const starlightProgramInfo: StarlightProgramInfo = {
                program: starlightShaderProgram,
                attribLocations: {
                    vertexPosition: gl.getAttribLocation(starlightShaderProgram, "aVertexPosition"),
                    vertexNormal: gl.getAttribLocation(starlightShaderProgram, "aVertexNormal"),
                    texCoords: gl.getAttribLocation(starlightShaderProgram, "aTexCoords"),
                },
                uniformLocations: {
                    projectionMatrix: gl.getUniformLocation(starlightShaderProgram, "uProjectionMatrix"),
                    modelMatrix: gl.getUniformLocation(starlightShaderProgram, "uModelMatrix"),
                    modelViewMatrix: gl.getUniformLocation(starlightShaderProgram, "uModelViewMatrix"),
                    normalMatrix: gl.getUniformLocation(starlightShaderProgram, "uNormalMatrix"),
                    uFragColor: gl.getUniformLocation(starlightShaderProgram, "uFragColor"),
                    uStarLocations: gl.getUniformLocation(starlightShaderProgram, "uStarLocations"),
                    uNumStars: gl.getUniformLocation(starlightShaderProgram, "uNumStars"),
                    uIsStar: gl.getUniformLocation(starlightShaderProgram, "uIsStar"),
                    uViewPosition: gl.getUniformLocation(starlightShaderProgram, "uViewPosition"),
                },
            };

            // Initialize texture shader for simple texture quad
            const texQuadShaderProgram = initShaderProgram(gl, vertTexQuad, fragTexQuad);
            if (!texQuadShaderProgram) {
                console.error("Failed to initialize texture shader program");
                return;
            }
            const texQuadProgramInfo: TexQuadProgramInfo = {
                program: texQuadShaderProgram,
                attribLocations: {
                    vertexPosition: gl.getAttribLocation(texQuadShaderProgram, "aVertexPosition"),
                    vertexNormal: gl.getAttribLocation(texQuadShaderProgram, "aVertexNormal"),
                    texCoords: gl.getAttribLocation(texQuadShaderProgram, "aTexCoords"),
                },
                uniformLocations: {
                    uScreenTex: gl.getUniformLocation(texQuadShaderProgram, "uScreenTex"),
                },
            };

            // Intitialize bloom shader
            const gaussianBlurShaderProgram = initShaderProgram(gl, vertGaussianBlur, fragGaussianBlur);
            if (!gaussianBlurShaderProgram) {
                console.error("Failed to initialize bloom shader program");
                return;
            }
            const gaussianBlurProgramInfo: GaussianBlurProgramInfo = {
                program: gaussianBlurShaderProgram,
                attribLocations: {
                    vertexPosition: gl.getAttribLocation(gaussianBlurShaderProgram, "aVertexPosition"),
                    vertexNormal: gl.getAttribLocation(gaussianBlurShaderProgram, "aVertexNormal"),
                    texCoords: gl.getAttribLocation(gaussianBlurShaderProgram, "aTexCoords"),
                },
                uniformLocations: {
                    uImage: gl.getUniformLocation(gaussianBlurShaderProgram, "uImage"),
                    uHorizontal: gl.getUniformLocation(gaussianBlurShaderProgram, "uHorizontal"),
                    uViewportSize: gl.getUniformLocation(gaussianBlurShaderProgram, "uViewportSize"),
                },
            };

            const bloomShaderProgram = initShaderProgram(gl, vertBloom, fragBloom);
            if (!bloomShaderProgram) {
                console.error("Failed to initialize bloom shader program");
                return;
            }
            const bloomProgramInfo: BloomProgramInfo = {
                program: bloomShaderProgram,
                attribLocations: {
                    vertexPosition: gl.getAttribLocation(bloomShaderProgram, "aVertexPosition"),
                    vertexNormal: gl.getAttribLocation(bloomShaderProgram, "aVertexNormal"),
                    texCoords: gl.getAttribLocation(bloomShaderProgram, "aTexCoords"),
                },
                uniformLocations: {
                    uScene: gl.getUniformLocation(bloomShaderProgram, "uScene"),
                    uBloom: gl.getUniformLocation(bloomShaderProgram, "uBloom"),
                },
            };

            /*****************************
             * Load Model Buffers
             *****************************/
            const sphere = await getModel("uvSphereSmooth.glb");
            const sphereBuffers = initBuffers(gl, sphere);
            if (!sphereBuffers) {
                console.error("Failed to initialize buffers");
                return;
            }

            // Create a simple quad for the purpose of displaying a rendered texture
            const quadModel: Model = {
                positions: new Float32Array([-1.0, 1.0, -1.0, -1.0, 1.0, -1.0, -1.0, 1.0, 1.0, -1.0, 1.0, 1.0]),
                texCoords: new Float32Array([0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 1.0, 0.0, 1.0, 1.0]),
                indices: new Uint16Array(),
                normals: new Float32Array(),
                indexCount: 0,
            };
            const quadBuffers = initBuffers(gl, quadModel);

            // Create a simple circle for the purpose of displaying debug distance circles
            const circleModel: Model = {
                positions: getCirclePositions([0, 0, 0], 1, NUM_CIRCLE_VERTICES),
                texCoords: new Float32Array(),
                indices: new Uint16Array(),
                normals: new Float32Array(),
                indexCount: 0,
            };
            const circleBuffers = initBuffers(gl, circleModel);

            /*
                Custom framebuffer intitialization
            */
            // Scene to texture with multisampling from the following source:
            // https://stackoverflow.com/questions/47934444/webgl-framebuffer-multisampling

            // Define textures
            const texWidth = canvas.width;
            const texHeight = canvas.height;

            // Define buffers
            const depthRenderBuffer = gl.createRenderbuffer();
            const sceneFrameBuffer = gl.createFramebuffer();
            const colorFrameBuffer = gl.createFramebuffer();
            const extractFrameBuffer = gl.createFramebuffer();
            const colorRenderBuffer = gl.createRenderbuffer();
            const starExtractRenderBuffer = gl.createRenderbuffer();

            gl.bindRenderbuffer(gl.RENDERBUFFER, depthRenderBuffer);
            gl.renderbufferStorageMultisample(
                gl.RENDERBUFFER,
                gl.getParameter(gl.MAX_SAMPLES),
                gl.DEPTH_COMPONENT24,
                texWidth,
                texHeight,
            );

            /*
                Define MSAA render buffers
            */

            let renderBufferInternalFormat: GLenum = gl.RGBA8;
            if (rgba32fSupported && oesTextureFloatLinearSupported) {
                renderBufferInternalFormat = gl.RGBA32F;
                dispatch({
                    type: "information/setInternalFormatUsed",
                    payload: "RGBA32F",
                });
            } else if (rgba16fSupported && oesTextureHalfFloatLinearSupported) {
                renderBufferInternalFormat = gl.RGBA16F;
                dispatch({
                    type: "information/setInternalFormatUsed",
                    payload: "RGBA16F",
                });
            } else {
                dispatch({
                    type: "information/setInternalFormatUsed",
                    payload: "RGBA8",
                });
            }

            gl.bindRenderbuffer(gl.RENDERBUFFER, colorRenderBuffer);
            gl.renderbufferStorageMultisample(
                gl.RENDERBUFFER,
                gl.getParameter(gl.MAX_SAMPLES),
                renderBufferInternalFormat,
                texWidth,
                texHeight,
            );

            gl.bindRenderbuffer(gl.RENDERBUFFER, starExtractRenderBuffer);
            gl.renderbufferStorageMultisample(
                gl.RENDERBUFFER,
                gl.getParameter(gl.MAX_SAMPLES),
                renderBufferInternalFormat,
                texWidth,
                texHeight,
            );

            // Attach depth and color render buffer to the scene frame buffer
            gl.bindFramebuffer(gl.FRAMEBUFFER, sceneFrameBuffer);
            gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]); // enable MRT
            gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, colorRenderBuffer);
            gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.RENDERBUFFER, starExtractRenderBuffer);
            gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depthRenderBuffer);

            // Create the texture that the entire unmodified scene is rendered to
            gl.bindFramebuffer(gl.FRAMEBUFFER, colorFrameBuffer);
            const textureColorBuffer = gl.createTexture();

            gl.bindTexture(gl.TEXTURE_2D, textureColorBuffer);
            // gl.texImage2D(
            //     gl.TEXTURE_2D,
            //     0,
            //     renderBufferInternalFormat,
            //     texWidth,
            //     texHeight,
            //     0,
            //     gl.RGBA,
            //     renderBufferType,
            //     null,
            // );
            gl.texStorage2D(gl.TEXTURE_2D, 1, renderBufferInternalFormat, texWidth, texHeight);

            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, textureColorBuffer, 0);

            // Create the texture where only the stars are rendered (for bloom)
            gl.bindFramebuffer(gl.FRAMEBUFFER, extractFrameBuffer);
            const starExtractTexture = gl.createTexture();

            gl.bindTexture(gl.TEXTURE_2D, starExtractTexture);
            // gl.texImage2D(
            //     gl.TEXTURE_2D,
            //     0,
            //     renderBufferInternalFormat,
            //     texWidth,
            //     texHeight,
            //     0,
            //     gl.RGBA,
            //     renderBufferType,
            //     null,
            // );
            gl.texStorage2D(gl.TEXTURE_2D, 1, renderBufferInternalFormat, texWidth, texHeight);

            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, starExtractTexture, 0);

            /*
                Bloom Framebuffers and Textures
            */
            const blurFrameBuffer: Array<WebGLFramebuffer> = [
                gl.createFramebuffer() as WebGLFramebuffer,
                gl.createFramebuffer() as WebGLFramebuffer,
            ];
            const blurTextures: Array<WebGLTexture> = [
                gl.createTexture() as WebGLTexture,
                gl.createTexture() as WebGLTexture,
            ];
            for (let i = 0; i < blurFrameBuffer.length; i++) {
                gl.bindFramebuffer(gl.FRAMEBUFFER, blurFrameBuffer[i]);
                gl.bindTexture(gl.TEXTURE_2D, blurTextures[i]);
                // gl.texImage2D(
                //     gl.TEXTURE_2D,
                //     0,
                //     renderBufferInternalFormat,
                //     texWidth,
                //     texHeight,
                //     0,
                //     gl.RGBA,
                //     renderBufferType,
                //     null,
                // );
                gl.texStorage2D(gl.TEXTURE_2D, 1, renderBufferInternalFormat, texWidth, texHeight);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, blurTextures[i], 0);
            }

            // Check if the framebuffer is complete
            if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
                console.error("Framebuffer is not complete");
            }

            /*
                Render Program
            */
            let then = 0;
            let accumulatedTime = 0;
            let uiAccumulatedTime = 0;
            const uiThrottleTime = 0.05; // time in seconds
            let tickCount = 0;
            let lastTickMeasure = 0;
            let measuerdTPS = 0;
            function render(now: number) {
                // Need to check this once per render to stop react from throwing an error
                if (!gl) {
                    console.error("WebGL context not found");
                    return;
                }

                /*
                    Update Universe
                */
                now *= 0.001; // convert to seconds
                const deltaTime = now - then;
                then = now;
                accumulatedTime += deltaTime;
                // Tick stuff

                //Update the universe simulation
                while (accumulatedTime >= secondsPerTick) {
                    if (!pausedRef.current) {
                        universe.current.updateEuler(secondsPerTick);
                        tickCount++;
                    }
                    accumulatedTime -= secondsPerTick;
                }

                // Measure TPS every second
                if (now - lastTickMeasure >= 1) {
                    measuerdTPS = tickCount / (now - lastTickMeasure);
                    tickCount = 0;
                    lastTickMeasure = now;
                    dispatch({ type: "information/setTPS", payload: measuerdTPS });
                }

                /*
                    Update UI with universe information.
                    This is throttled as not to cause too many rerenders.
                */
                uiAccumulatedTime += deltaTime;
                if (uiAccumulatedTime >= uiThrottleTime) {
                    if (!pausedRef.current) {
                        setLeaderboardBodies(universe.current.getActiveBodies(bodyFollowedRef.current));
                        dispatch({ type: "information/setNumActiveBodies", payload: universe.current.numActive });
                        dispatch({ type: "information/setNumStars", payload: universe.current.getNumStars() });
                    }

                    dispatch({
                        type: "information/setNumActiveUniforms",
                        payload: starLightRef.current
                            ? gl.getProgramParameter(starlightProgramInfo.program, gl.ACTIVE_UNIFORMS)
                            : gl.getProgramParameter(camlightProgramInfo.program, gl.ACTIVE_UNIFORMS),
                    });
                    dispatch({
                        type: "information/setNumActiveUniformVectors",
                        payload: starLightRef.current
                            ? calculateUniformVectors(gl, starlightProgramInfo.program)
                            : calculateUniformVectors(gl, camlightProgramInfo.program),
                    });
                    dispatch({
                        type: "information/setYearsElapsed",
                        payload: universe.current.timeElapsed,
                    });
                    const followedBodyRadius = bodyFollowedRef.current
                        ? universe.current.getRadius(bodyFollowedRef.current)
                        : null;
                    dispatch({
                        type: "information/setFollowedBodyRadius",
                        payload: followedBodyRadius,
                    });
                    uiAccumulatedTime = 0;

                    // Performance stuff
                    dispatch({
                        type: "information/setFPS",
                        payload: Math.round(1 / deltaTime),
                    });
                }

                /*
                    Render scene from universe
                */
                // Set GL active texture to the default of 0 for safety
                gl.activeTexture(gl.TEXTURE0);

                // Create Projection Matrix (used by all shaders)
                const projectionMatrix = mat4.create();
                const canvas = gl.canvas as HTMLCanvasElement;
                const aspect = canvas.clientWidth / canvas.clientHeight;
                mat4.perspective(projectionMatrix, fieldOfView, aspect, zNear, zFar);
                // Create View Matrix (used by all shaders)
                if (bodyFollowedRef.current !== -1) {
                    cameraRef.current.setTarget(
                        universe.current.positionsX[bodyFollowedRef.current],
                        universe.current.positionsY[bodyFollowedRef.current],
                        universe.current.positionsZ[bodyFollowedRef.current],
                    );
                }
                const viewMatrix = cameraRef.current.getViewMatrix();

                // Bind scene framebuffer and clear
                gl.bindFramebuffer(gl.FRAMEBUFFER, sceneFrameBuffer);
                gl.clearColor(0.0, 0.0, 0.0, 1.0); // Clear to black, fully opaque
                gl.clearDepth(1.0); // Clear everything
                gl.enable(gl.DEPTH_TEST); // Enable depth testing
                gl.depthFunc(gl.LEQUAL); // Near things obscure far things
                gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

                /*
                    Draw debug circles
                */
                if (!(circleTypeRef.current == CircleType.NONE)) {
                    gl.useProgram(simpleProgramInfo.program);
                    gl.bindBuffer(gl.ARRAY_BUFFER, circleBuffers.position);
                    setPositionAttribute(gl, circleBuffers, simpleProgramInfo.attribLocations);

                    const dAUIncremental = [1, 2, 3, 4, 5, 10, 15, 20, 30, 40, 50];
                    const dAUSolar = [
                        SolarSystemDistanceAU.MERCURY,
                        SolarSystemDistanceAU.VENUS,
                        SolarSystemDistanceAU.EARTH,
                        SolarSystemDistanceAU.MARS,
                        SolarSystemDistanceAU.JUPITER,
                        SolarSystemDistanceAU.SATURN,
                        SolarSystemDistanceAU.URANUS,
                        SolarSystemDistanceAU.NEPTUNE,
                        SolarSystemDistanceAU.PLUTO,
                    ];
                    const colorSolar = [
                        [0.62, 0.412, 0.518], // Mercury is purpleish
                        [1, 0.933, 0.71], // Venus is yellowish
                        [0.2, 0.6, 1], // Earth is blue
                        [1, 0.478, 0.176], // Mars is orange
                        [1, 0.82, 0.573], // Jupiter is red
                        [1, 0.902, 0.573], // Saturn is tannish yellow
                        [0.486, 1, 0.996], // Uranus is sky blue
                        [0.486, 0.565, 1], // Neptune is deep blue
                        [0.812, 0.812, 0.812], // Pluto is grey
                    ];

                    const dAU = circleTypeRef.current === CircleType.SOLAR ? dAUSolar : dAUIncremental;

                    const camTarget = cameraRef.current.getTarget();

                    for (let i = 0; i < dAU.length; i++) {
                        const circleModelMatrix = mat4.create();
                        mat4.translate(circleModelMatrix, circleModelMatrix, [
                            camTarget[0],
                            camTarget[1],
                            camTarget[2],
                        ]);
                        mat4.scale(circleModelMatrix, circleModelMatrix, [dAU[i], dAU[i], dAU[i]]);
                        const circleModelViewMatrix = mat4.create();
                        mat4.multiply(circleModelViewMatrix, viewMatrix, circleModelMatrix);

                        gl.uniformMatrix4fv(
                            simpleProgramInfo.uniformLocations.projectionMatrix,
                            false,
                            projectionMatrix,
                        );
                        gl.uniformMatrix4fv(
                            simpleProgramInfo.uniformLocations.modelViewMatrix,
                            false,
                            circleModelViewMatrix,
                        );

                        if (circleTypeRef.current === CircleType.SOLAR) {
                            gl.uniform4fv(simpleProgramInfo.uniformLocations.uFragColor, [
                                colorSolar[i][0],
                                colorSolar[i][1],
                                colorSolar[i][2],
                                1,
                            ]);
                        } else {
                            gl.uniform4fv(simpleProgramInfo.uniformLocations.uFragColor, [1, 1, 1, 1]);
                        }

                        gl.lineWidth(4.0);
                        gl.drawArrays(gl.LINE_LOOP, 0, NUM_CIRCLE_VERTICES);
                    }
                }

                // Bind sphere buffers
                gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, sphereBuffers.indices);
                gl.bindBuffer(gl.ARRAY_BUFFER, sphereBuffers.position);
                gl.bindBuffer(gl.ARRAY_BUFFER, sphereBuffers.normal);

                // Set sphere lighting shader
                if (starLightRef.current) {
                    setPositionAttribute(gl, sphereBuffers, starlightProgramInfo.attribLocations);
                    setNormalAttribute(gl, sphereBuffers, starlightProgramInfo.attribLocations);
                    gl.useProgram(starlightProgramInfo.program);

                    // Bind projection matrix
                    gl.uniformMatrix4fv(
                        starlightProgramInfo.uniformLocations.projectionMatrix,
                        false,
                        projectionMatrix,
                    );

                    // Data for calculating star light
                    const starData: Array<vec4> = universe.current.getStarData();
                    const numStars = starData.length;
                    gl.uniform1i(starlightProgramInfo.uniformLocations.uNumStars, numStars);

                    if (numStars > 0) {
                        const flattenedStarLocs = starData.flatMap((vec) => [vec[0], vec[1], vec[2]]);
                        gl.uniform3fv(starlightProgramInfo.uniformLocations.uStarLocations, flattenedStarLocs);
                    }

                    const viewPos = cameraRef.current.getPosition();
                    gl.uniform3fv(starlightProgramInfo.uniformLocations.uViewPosition, viewPos);
                } else {
                    // Bind Buffers
                    setPositionAttribute(gl, sphereBuffers, camlightProgramInfo.attribLocations);
                    setNormalAttribute(gl, sphereBuffers, camlightProgramInfo.attribLocations);

                    gl.useProgram(camlightProgramInfo.program);

                    // Bind projection matrix
                    gl.uniformMatrix4fv(camlightProgramInfo.uniformLocations.projectionMatrix, false, projectionMatrix);
                }

                /*
                    Draw Scene
                */
                for (let i = 0; i < universe.current.settings.numBodies; i++) {
                    if (!universe.current.bodiesActive[i]) {
                        continue;
                    }

                    const modelMatrix = mat4.create();
                    mat4.translate(modelMatrix, modelMatrix, [
                        universe.current.positionsX[i],
                        universe.current.positionsY[i],
                        universe.current.positionsZ[i],
                    ]);
                    mat4.scale(modelMatrix, modelMatrix, [
                        universe.current.radii[i],
                        universe.current.radii[i],
                        universe.current.radii[i],
                    ]);

                    const modelViewMatrix = mat4.create();
                    mat4.multiply(modelViewMatrix, viewMatrix, modelMatrix);

                    // Bind uniforms based on current lighting mode

                    if (starLightRef.current) {
                        const normalMatrix = mat4.create();
                        mat4.invert(normalMatrix, modelMatrix);
                        mat4.transpose(normalMatrix, normalMatrix);

                        gl.uniformMatrix4fv(starlightProgramInfo.uniformLocations.modelMatrix, false, modelMatrix);
                        gl.uniformMatrix4fv(
                            starlightProgramInfo.uniformLocations.modelViewMatrix,
                            false,
                            modelViewMatrix,
                        );
                        gl.uniformMatrix4fv(starlightProgramInfo.uniformLocations.normalMatrix, false, normalMatrix);
                        const isStar = universe.current.isStar(i) ? 1 : 0;
                        gl.uniform1i(starlightProgramInfo.uniformLocations.uIsStar, isStar);
                        gl.uniform4fv(starlightProgramInfo.uniformLocations.uFragColor, [
                            universe.current.colorsR[i],
                            universe.current.colorsG[i],
                            universe.current.colorsB[i],
                            1.0,
                        ]);
                    } else {
                        const normalMatrix = mat4.create();
                        mat4.invert(normalMatrix, modelViewMatrix);
                        mat4.transpose(normalMatrix, normalMatrix);

                        gl.uniformMatrix4fv(
                            camlightProgramInfo.uniformLocations.modelViewMatrix,
                            false,
                            modelViewMatrix,
                        );
                        gl.uniformMatrix4fv(camlightProgramInfo.uniformLocations.normalMatrix, false, normalMatrix);
                        gl.uniform4fv(camlightProgramInfo.uniformLocations.uFragColor, [
                            universe.current.colorsR[i],
                            universe.current.colorsG[i],
                            universe.current.colorsB[i],
                            1.0,
                        ]);
                    }

                    // Draw each sphere
                    {
                        const type = gl.UNSIGNED_SHORT;
                        2;
                        const offset = 0;
                        gl.drawElements(gl.TRIANGLES, sphere.indexCount, type, offset);
                    }
                }

                /*
                    Antialiasing Pass
                */
                gl.readBuffer(gl.COLOR_ATTACHMENT0);
                gl.bindFramebuffer(gl.READ_FRAMEBUFFER, sceneFrameBuffer);
                gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, colorFrameBuffer);
                gl.clearBufferfv(gl.COLOR, 0, [1.0, 1.0, 1.0, 1.0]);
                gl.blitFramebuffer(
                    0,
                    0,
                    texWidth,
                    texHeight,
                    0,
                    0,
                    texWidth,
                    texHeight,
                    gl.COLOR_BUFFER_BIT,
                    gl.LINEAR,
                );

                gl.readBuffer(gl.COLOR_ATTACHMENT1);
                gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, extractFrameBuffer);
                gl.blitFramebuffer(
                    0,
                    0,
                    texWidth,
                    texHeight,
                    0,
                    0,
                    texWidth,
                    texHeight,
                    gl.COLOR_BUFFER_BIT,
                    gl.LINEAR,
                );

                if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
                    console.error("Framebuffer is not complete");
                }

                /*
                    Bloom Blur
                */
                if (starLightRef.current) {
                    gl.useProgram(gaussianBlurProgramInfo.program);
                    setPositionAttribute2D(gl, quadBuffers, gaussianBlurProgramInfo.attribLocations);
                    setTexCoordAttribute(gl, quadBuffers, gaussianBlurProgramInfo.attribLocations);

                    // Pingpong algorithm for gaussian blur
                    const blurAmount = 10;
                    let horizontal = 0;
                    let first_iteration = true;
                    for (let i = 0; i < blurAmount; i++) {
                        gl.bindFramebuffer(gl.FRAMEBUFFER, blurFrameBuffer[horizontal]);
                        // Set horizontal int to horizontal
                        gl.uniform1i(gaussianBlurProgramInfo.uniformLocations.uHorizontal, horizontal);
                        gl.uniform2fv(gaussianBlurProgramInfo.uniformLocations.uViewportSize, [
                            canvas.clientWidth,
                            canvas.clientHeight,
                        ]);
                        // Set texture to read from
                        gl.bindTexture(
                            gl.TEXTURE_2D,
                            first_iteration ? starExtractTexture : blurTextures[1 - horizontal],
                        );
                        gl.drawArrays(gl.TRIANGLES, 0, 6);
                        horizontal = 1 - horizontal;
                        if (first_iteration) {
                            first_iteration = false;
                        }
                    }
                    gl.useProgram(bloomProgramInfo.program);

                    // Add the blur texture and scene texture together for bloom
                    gl.activeTexture(gl.TEXTURE0);
                    gl.bindTexture(gl.TEXTURE_2D, textureColorBuffer);
                    gl.uniform1i(bloomProgramInfo.uniformLocations.uScene, 0);

                    gl.activeTexture(gl.TEXTURE1);
                    gl.bindTexture(gl.TEXTURE_2D, blurTextures[horizontal]);
                    gl.uniform1i(bloomProgramInfo.uniformLocations.uBloom, 1);

                    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffers.position);
                    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
                    gl.drawArrays(gl.TRIANGLES, 0, 6);

                    /*
                    gl.useProgram(texQuadProgramInfo.program);

                    gl.activeTexture(gl.TEXTURE0);
                    gl.bindTexture(gl.TEXTURE_2D, textureColorBuffer);
                    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
                    gl.drawArrays(gl.TRIANGLES, 0, 6);
                    */
                } else {
                    gl.useProgram(texQuadProgramInfo.program);
                    gl.bindTexture(gl.TEXTURE_2D, textureColorBuffer);
                    setPositionAttribute2D(gl, quadBuffers, texQuadProgramInfo.attribLocations);
                    setTexCoordAttribute(gl, quadBuffers, texQuadProgramInfo.attribLocations);

                    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
                    gl.drawArrays(gl.TRIANGLES, 0, 6);
                }
                requestAnimationFrame(render);
            }

            requestAnimationFrame(render);
        };

        initialize();
    }, []); // Runs once when the component mounts

    return (
        <SimCanvas
            ref={canvasRef}
            height={1080}
            width={1920}
            onWheel={handleMouseWheel}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
        />
    );
}

const SimCanvas = styled.canvas`
    height: 100%;
    width: 100%;
    display: block;
    touch-action: none;
`;
