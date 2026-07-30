"use client";

import { useState, useEffect, useCallback, useRef } from "react";

export type CameraPermissionStatus = 
  | "pending"      // Initial state, checking permission
  | "prompt"       // Browser will prompt user
  | "granted"      // Permission granted
  | "denied"       // Permission denied
  | "unavailable"  // Camera not available on device
  | "insecure"     // Running on HTTP non-localhost origin
  | "error";       // Error occurred

export interface CameraPermissionState {
  status: CameraPermissionStatus;
  stream: MediaStream | null;
  error: string | null;
  isChecking: boolean;
  isRequesting: boolean;
  deviceInfo: MediaDeviceInfo | null;
  isInsecureContext: boolean;
}

export interface UseCameraPermissionReturn extends CameraPermissionState {
  checkPermission: () => Promise<CameraPermissionStatus>;
  requestPermission: () => Promise<MediaStream | null>;
  requestMockPermission: () => MediaStream;
  stopStream: () => void;
  retryPermission: () => Promise<void>;
  transferStream: () => void;
}

// Generate a synthetic MediaStream for insecure HTTP testing (e.g. http://192.168.0.203:3000)
function createMockStream(): MediaStream {
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 480;
  const ctx = canvas.getContext("2d");

  let animationFrameId: number;
  const draw = () => {
    if (!ctx) return;
    // Dark background
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, 0, 640, 480);
    
    // Draw face silhouette
    ctx.fillStyle = "#38bdf8";
    ctx.beginPath();
    ctx.arc(320, 200, 75, 0, Math.PI * 2);
    ctx.fill();

    // Eyes
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(295, 190, 10, 0, Math.PI * 2);
    ctx.arc(345, 190, 10, 0, Math.PI * 2);
    ctx.fill();

    // Text
    ctx.fillStyle = "#f8fafc";
    ctx.font = "bold 18px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Camera Test Mode (HTTP IP)", 320, 330);
    
    ctx.font = "14px sans-serif";
    ctx.fillStyle = "#94a3b8";
    ctx.fillText(`Live Feed - ${new Date().toLocaleTimeString()}`, 320, 360);

    animationFrameId = requestAnimationFrame(draw);
  };
  draw();

  const stream = canvas.captureStream(15);
  return stream;
}

/**
 * Custom hook for managing camera permissions across all devices
 * Handles iOS Safari, Android Chrome, Desktop browsers, and edge cases
 */
export function useCameraPermission(): UseCameraPermissionReturn {
  const isInsecureContext = typeof window !== "undefined" && !window.isSecureContext;

  const [state, setState] = useState<CameraPermissionState>({
    status: "pending",
    stream: null,
    error: null,
    isChecking: true,
    isRequesting: false,
    deviceInfo: null,
    isInsecureContext,
  });

  const streamRef = useRef<MediaStream | null>(null);

  // Check if camera is available on the device
  const isCameraAvailable = useCallback(async (): Promise<boolean> => {
    try {
      // Check if mediaDevices API is available
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        return false;
      }

      // Check if there are any video input devices
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(device => device.kind === "videoinput");
      
      if (videoDevices.length > 0) {
        setState(prev => ({ ...prev, deviceInfo: videoDevices[0] }));
      }
      
      return videoDevices.length > 0;
    } catch {
      return false;
    }
  }, []);

  // Check current permission status without prompting
  const checkPermission = useCallback(async (): Promise<CameraPermissionStatus> => {
    setState(prev => ({ ...prev, isChecking: true }));

    try {
      if (typeof window !== "undefined" && !window.isSecureContext) {
        setState(prev => ({
          ...prev,
          status: "insecure",
          isChecking: false,
          error: "Browser blocked camera access because page is served over HTTP IP (non-secure context).",
        }));
        return "insecure";
      }

      // First check if camera is available
      const available = await isCameraAvailable();
      if (!available) {
        setState(prev => ({ 
          ...prev, 
          status: "unavailable", 
          isChecking: false,
          error: "No camera found on this device" 
        }));
        return "unavailable";
      }

      // Use Permissions API if available
      if (navigator.permissions && navigator.permissions.query) {
        try {
          const result = await navigator.permissions.query({ name: "camera" as PermissionName });
          
          const status = result.state === "granted" ? "granted" 
            : result.state === "denied" ? "denied" 
            : "prompt";

          setState(prev => ({ 
            ...prev, 
            status, 
            isChecking: false,
            error: status === "denied" ? "Camera permission was denied" : null
          }));

          result.addEventListener("change", () => {
            const newStatus = result.state === "granted" ? "granted" 
              : result.state === "denied" ? "denied" 
              : "prompt";
            setState(prev => ({ 
              ...prev, 
              status: newStatus,
              error: newStatus === "denied" ? "Camera permission was denied" : null
            }));
          });

          return status;
        } catch {
          setState(prev => ({ ...prev, status: "prompt", isChecking: false }));
          return "prompt";
        }
      }

      setState(prev => ({ ...prev, status: "prompt", isChecking: false }));
      return "prompt";
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error checking camera permission";
      setState(prev => ({ 
        ...prev, 
        status: "error", 
        isChecking: false,
        error: errorMessage 
      }));
      return "error";
    }
  }, [isCameraAvailable]);

  // Request camera permission and get stream
  const requestPermission = useCallback(async (): Promise<MediaStream | null> => {
    setState(prev => ({ ...prev, isRequesting: true, error: null }));

    try {
      if (typeof window !== "undefined" && !window.isSecureContext) {
        const mockStream = createMockStream();
        streamRef.current = mockStream;
        setState(prev => ({
          ...prev,
          status: "granted",
          stream: mockStream,
          isRequesting: false,
          error: null,
        }));
        return mockStream;
      }

      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }

      const constraints: MediaStreamConstraints = {
        video: {
          facingMode: "user",
          width: { ideal: 640, max: 1280 },
          height: { ideal: 480, max: 720 },
          frameRate: { ideal: 15, max: 30 },
        },
        audio: false,
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      
      streamRef.current = stream;
      setState(prev => ({ 
        ...prev, 
        status: "granted", 
        stream, 
        isRequesting: false,
        error: null 
      }));

      return stream;
    } catch (error) {
      let errorMessage = "Failed to access camera";
      let status: CameraPermissionStatus = "error";

      if (error instanceof Error) {
        switch (error.name) {
          case "NotAllowedError":
          case "PermissionDeniedError":
            errorMessage = "Camera permission was denied. Please allow camera access in your browser settings.";
            status = "denied";
            break;
          case "NotFoundError":
          case "DevicesNotFoundError":
            errorMessage = "No camera found on this device.";
            status = "unavailable";
            break;
          case "SecurityError":
            errorMessage = "Camera access is blocked on HTTP IP address. You can enable Test Mode below.";
            status = "insecure";
            break;
          default:
            errorMessage = error.message || "An unexpected error occurred while accessing the camera.";
        }
      }

      setState(prev => ({ 
        ...prev, 
        status, 
        stream: null, 
        isRequesting: false,
        error: errorMessage 
      }));

      return null;
    }
  }, []);

  const requestMockPermission = useCallback((): MediaStream => {
    const mockStream = createMockStream();
    streamRef.current = mockStream;
    setState(prev => ({
      ...prev,
      status: "granted",
      stream: mockStream,
      isRequesting: false,
      error: null,
    }));
    return mockStream;
  }, []);

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => {
        track.stop();
      });
      streamRef.current = null;
      setState(prev => ({ ...prev, stream: null }));
    }
  }, []);

  const transferStream = useCallback(() => {
    streamRef.current = null;
  }, []);

  const retryPermission = useCallback(async () => {
    setState(prev => ({ ...prev, error: null }));
    await checkPermission();
    if (state.status !== "denied") {
      await requestPermission();
    }
  }, [checkPermission, requestPermission, state.status]);

  useEffect(() => {
    checkPermission();
  }, [checkPermission]);

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  return {
    ...state,
    checkPermission,
    requestPermission,
    requestMockPermission,
    stopStream,
    retryPermission,
    transferStream,
  };
}
