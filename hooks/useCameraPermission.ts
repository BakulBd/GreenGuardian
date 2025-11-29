"use client";

import { useState, useEffect, useCallback, useRef } from "react";

export type CameraPermissionStatus = 
  | "pending"      // Initial state, checking permission
  | "prompt"       // Browser will prompt user
  | "granted"      // Permission granted
  | "denied"       // Permission denied
  | "unavailable"  // Camera not available on device
  | "error";       // Error occurred

export interface CameraPermissionState {
  status: CameraPermissionStatus;
  stream: MediaStream | null;
  error: string | null;
  isChecking: boolean;
  isRequesting: boolean;
  deviceInfo: MediaDeviceInfo | null;
}

export interface UseCameraPermissionReturn extends CameraPermissionState {
  checkPermission: () => Promise<CameraPermissionStatus>;
  requestPermission: () => Promise<MediaStream | null>;
  stopStream: () => void;
  retryPermission: () => Promise<void>;
  transferStream: () => void;
}

/**
 * Custom hook for managing camera permissions across all devices
 * Handles iOS Safari, Android Chrome, Desktop browsers, and edge cases
 */
export function useCameraPermission(): UseCameraPermissionReturn {
  const [state, setState] = useState<CameraPermissionState>({
    status: "pending",
    stream: null,
    error: null,
    isChecking: true,
    isRequesting: false,
    deviceInfo: null,
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

      // Use Permissions API if available (not supported on iOS Safari)
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

          // Listen for permission changes
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
          // Permissions API not supported for camera, fallback to prompt
          setState(prev => ({ ...prev, status: "prompt", isChecking: false }));
          return "prompt";
        }
      }

      // Fallback for browsers without Permissions API
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
      // Stop any existing stream first
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }

      // Request camera access with optimized constraints
      const constraints: MediaStreamConstraints = {
        video: {
          facingMode: "user", // Front camera for proctoring
          width: { ideal: 640, max: 1280 },
          height: { ideal: 480, max: 720 },
          frameRate: { ideal: 15, max: 30 }, // Lower frame rate for performance
        },
        audio: false,
      };

      // Try to get the stream
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
        // Handle specific error types
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
          case "NotReadableError":
          case "TrackStartError":
            errorMessage = "Camera is being used by another application. Please close other apps using the camera.";
            break;
          case "OverconstrainedError":
            errorMessage = "Camera doesn't support the required settings. Trying with default settings...";
            // Try again with minimal constraints
            try {
              const fallbackStream = await navigator.mediaDevices.getUserMedia({ 
                video: true, 
                audio: false 
              });
              streamRef.current = fallbackStream;
              setState(prev => ({ 
                ...prev, 
                status: "granted", 
                stream: fallbackStream, 
                isRequesting: false,
                error: null 
              }));
              return fallbackStream;
            } catch {
              errorMessage = "Camera is not compatible with this application.";
            }
            break;
          case "AbortError":
            errorMessage = "Camera access was interrupted. Please try again.";
            break;
          case "SecurityError":
            errorMessage = "Camera access is not allowed on this page. Please ensure you're using HTTPS.";
            break;
          case "TypeError":
            errorMessage = "Invalid camera configuration. Please refresh and try again.";
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

  // Stop the camera stream
  const stopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => {
        track.stop();
      });
      streamRef.current = null;
      setState(prev => ({ ...prev, stream: null }));
    }
  }, []);

  // Mark stream as transferred to parent (won't be stopped on unmount)
  const transferStream = useCallback(() => {
    // Clear our reference so we don't stop it on unmount
    streamRef.current = null;
  }, []);

  // Retry permission request
  const retryPermission = useCallback(async () => {
    setState(prev => ({ ...prev, error: null }));
    await checkPermission();
    if (state.status !== "denied") {
      await requestPermission();
    }
  }, [checkPermission, requestPermission, state.status]);

  // Initial permission check on mount
  useEffect(() => {
    checkPermission();
  }, [checkPermission]);

  // Cleanup on unmount - only stop if we still own the stream
  useEffect(() => {
    return () => {
      // Only stop if streamRef is still set (not transferred to parent)
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  return {
    ...state,
    checkPermission,
    requestPermission,
    stopStream,
    retryPermission,
    transferStream,
  };
}
