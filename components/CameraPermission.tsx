"use client";

import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { 
  Camera, 
  CameraOff, 
  AlertTriangle, 
  CheckCircle, 
  RefreshCw, 
  Settings,
  Loader2,
  Monitor,
  Smartphone,
  Shield,
  Info
} from "lucide-react";
import { useCameraPermission, CameraPermissionStatus } from "@/hooks/useCameraPermission";

interface CameraPermissionProps {
  onPermissionGranted: (stream: MediaStream) => void;
  onPermissionDenied?: () => void;
  onSkip?: () => void;
  required?: boolean;
  title?: string;
  description?: string;
}

export default function CameraPermission({
  onPermissionGranted,
  onPermissionDenied,
  onSkip,
  required = true,
  title = "Camera Access Required",
  description = "This exam requires camera access for proctoring. Please allow camera access to continue."
}: CameraPermissionProps) {
  const {
    status,
    stream,
    error,
    isChecking,
    isRequesting,
    deviceInfo,
    requestPermission,
    retryPermission,
    stopStream,
    transferStream,
  } = useCameraPermission();

  const videoRef = useRef<HTMLVideoElement>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);
  const [streamTransferred, setStreamTransferred] = useState(false);

  // Attach stream to video element for preview
  useEffect(() => {
    if (stream && videoRef.current) {
      videoRef.current.srcObject = stream;
      setShowPreview(true);
    }
  }, [stream]);

  // Notify parent when permission is granted
  useEffect(() => {
    if (status === "granted" && stream && !streamTransferred) {
      // Small delay to ensure video is playing
      const timer = setTimeout(() => {
        // Transfer ownership to parent - stream won't be stopped when this component unmounts
        transferStream();
        setStreamTransferred(true);
        onPermissionGranted(stream);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [status, stream, onPermissionGranted, streamTransferred, transferStream]);

  // Notify parent when permission is denied
  useEffect(() => {
    if (status === "denied" && onPermissionDenied) {
      onPermissionDenied();
    }
  }, [status, onPermissionDenied]);

  const handleRequestPermission = async () => {
    const result = await requestPermission();
    if (!result && onPermissionDenied) {
      onPermissionDenied();
    }
  };

  const getStatusIcon = () => {
    switch (status) {
      case "pending":
      case "prompt":
        return <Camera className="h-12 w-12 text-blue-500" />;
      case "granted":
        return <CheckCircle className="h-12 w-12 text-green-500" />;
      case "denied":
        return <CameraOff className="h-12 w-12 text-red-500" />;
      case "unavailable":
        return <AlertTriangle className="h-12 w-12 text-yellow-500" />;
      case "error":
        return <AlertTriangle className="h-12 w-12 text-red-500" />;
      default:
        return <Camera className="h-12 w-12 text-gray-500" />;
    }
  };

  const getStatusBadge = () => {
    switch (status) {
      case "pending":
        return <Badge variant="secondary">Checking...</Badge>;
      case "prompt":
        return <Badge variant="outline" className="border-blue-500 text-blue-500">Waiting for Permission</Badge>;
      case "granted":
        return <Badge className="bg-green-500">Access Granted</Badge>;
      case "denied":
        return <Badge variant="destructive">Access Denied</Badge>;
      case "unavailable":
        return <Badge variant="outline" className="border-yellow-500 text-yellow-500">Camera Unavailable</Badge>;
      case "error":
        return <Badge variant="destructive">Error</Badge>;
    }
  };

  const getDeviceType = () => {
    const ua = navigator.userAgent;
    if (/iPad|iPhone|iPod/.test(ua)) return "ios";
    if (/Android/.test(ua)) return "android";
    return "desktop";
  };

  const getBrowserInstructions = () => {
    const device = getDeviceType();
    const ua = navigator.userAgent;
    
    if (device === "ios") {
      if (/Safari/.test(ua) && !/Chrome|CriOS|FxiOS/.test(ua)) {
        return {
          browser: "Safari (iOS)",
          steps: [
            "Go to Settings on your iPhone/iPad",
            "Scroll down and tap Safari",
            "Scroll down to 'Settings for Websites'",
            "Tap Camera",
            "Select 'Allow' or 'Ask'",
            "Return to this page and refresh"
          ]
        };
      }
      return {
        browser: "iOS Browser",
        steps: [
          "Open Settings app",
          "Find your browser (Chrome, Firefox, etc.)",
          "Enable Camera permission",
          "Return to this page and refresh"
        ]
      };
    }
    
    if (device === "android") {
      return {
        browser: "Android Browser",
        steps: [
          "Tap the lock icon in the address bar",
          "Tap 'Site settings' or 'Permissions'",
          "Find Camera and set to 'Allow'",
          "Refresh this page"
        ]
      };
    }
    
    // Desktop browsers
    if (/Chrome/.test(ua)) {
      return {
        browser: "Google Chrome",
        steps: [
          "Click the lock/info icon in the address bar",
          "Click 'Site settings'",
          "Find Camera and set to 'Allow'",
          "Refresh this page"
        ]
      };
    }
    
    if (/Firefox/.test(ua)) {
      return {
        browser: "Mozilla Firefox",
        steps: [
          "Click the lock icon in the address bar",
          "Click 'Connection secure' → 'More information'",
          "Go to 'Permissions' tab",
          "Find Camera and click 'Allow'",
          "Refresh this page"
        ]
      };
    }
    
    if (/Safari/.test(ua)) {
      return {
        browser: "Safari (macOS)",
        steps: [
          "Click Safari in the menu bar",
          "Click 'Settings for This Website'",
          "Find Camera and set to 'Allow'",
          "Refresh this page"
        ]
      };
    }
    
    if (/Edg/.test(ua)) {
      return {
        browser: "Microsoft Edge",
        steps: [
          "Click the lock icon in the address bar",
          "Click 'Permissions for this site'",
          "Find Camera and set to 'Allow'",
          "Refresh this page"
        ]
      };
    }
    
    return {
      browser: "Your Browser",
      steps: [
        "Look for a camera icon in the address bar",
        "Click on site settings or permissions",
        "Enable camera access for this site",
        "Refresh this page"
      ]
    };
  };

  const renderContent = () => {
    if (isChecking) {
      return (
        <div className="flex flex-col items-center justify-center py-8 space-y-4">
          <Loader2 className="h-12 w-12 animate-spin text-primary-500" />
          <p className="text-gray-600">Checking camera availability...</p>
        </div>
      );
    }

    if (status === "granted" && stream) {
      return (
        <div className="space-y-4">
          <div className="flex items-center justify-center space-x-2 text-green-600">
            <CheckCircle className="h-6 w-6" />
            <span className="font-medium">Camera access granted!</span>
          </div>
          
          {showPreview && (
            <div className="relative rounded-lg overflow-hidden bg-black aspect-video max-w-md mx-auto">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover mirror"
                style={{ transform: "scaleX(-1)" }}
              />
              <div className="absolute top-2 left-2">
                <Badge className="bg-green-500/80">
                  <span className="animate-pulse mr-1">●</span> Live
                </Badge>
              </div>
            </div>
          )}
          
          <p className="text-center text-gray-600 text-sm">
            Your camera is ready. You can proceed with the exam.
          </p>
        </div>
      );
    }

    if (status === "denied") {
      const instructions = getBrowserInstructions();
      return (
        <div className="space-y-4">
          <Alert variant="destructive">
            <CameraOff className="h-4 w-4" />
            <AlertTitle>Camera Access Denied</AlertTitle>
            <AlertDescription>
              {error || "You have denied camera access. Please enable it in your browser settings."}
            </AlertDescription>
          </Alert>

          <div className="bg-gray-50 rounded-lg p-4 space-y-3">
            <div className="flex items-center space-x-2">
              <Settings className="h-5 w-5 text-gray-600" />
              <span className="font-medium text-gray-700">How to enable camera in {instructions.browser}:</span>
            </div>
            <ol className="list-decimal list-inside space-y-2 text-sm text-gray-600">
              {instructions.steps.map((step, index) => (
                <li key={index}>{step}</li>
              ))}
            </ol>
          </div>

          <div className="flex justify-center space-x-3">
            <Button onClick={() => window.location.reload()} variant="outline">
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh Page
            </Button>
            <Button onClick={retryPermission}>
              <Camera className="h-4 w-4 mr-2" />
              Try Again
            </Button>
          </div>
        </div>
      );
    }

    if (status === "unavailable") {
      return (
        <div className="space-y-4">
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Camera Not Found</AlertTitle>
            <AlertDescription>
              No camera was detected on your device. Please connect a camera or use a device with a built-in camera.
            </AlertDescription>
          </Alert>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex items-start space-x-3 p-3 bg-gray-50 rounded-lg">
              <Monitor className="h-6 w-6 text-gray-500 mt-0.5" />
              <div>
                <p className="font-medium text-sm">Desktop/Laptop</p>
                <p className="text-xs text-gray-600">Connect a USB webcam or use a laptop with built-in camera</p>
              </div>
            </div>
            <div className="flex items-start space-x-3 p-3 bg-gray-50 rounded-lg">
              <Smartphone className="h-6 w-6 text-gray-500 mt-0.5" />
              <div>
                <p className="font-medium text-sm">Mobile Device</p>
                <p className="text-xs text-gray-600">Use a smartphone or tablet with a front camera</p>
              </div>
            </div>
          </div>

          <div className="flex justify-center">
            <Button onClick={retryPermission} variant="outline">
              <RefreshCw className="h-4 w-4 mr-2" />
              Check Again
            </Button>
          </div>
        </div>
      );
    }

    if (status === "error") {
      return (
        <div className="space-y-4">
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Camera Error</AlertTitle>
            <AlertDescription>
              {error || "An error occurred while accessing your camera. Please try again."}
            </AlertDescription>
          </Alert>

          <div className="flex justify-center space-x-3">
            <Button onClick={retryPermission}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Try Again
            </Button>
          </div>
        </div>
      );
    }

    // Default: prompt status
    return (
      <div className="space-y-6">
        <div className="text-center space-y-2">
          <div className="flex justify-center">
            <div className="p-4 bg-blue-50 rounded-full">
              <Camera className="h-12 w-12 text-blue-500" />
            </div>
          </div>
          <p className="text-gray-600">
            Click the button below to allow camera access. Your browser will ask for permission.
          </p>
        </div>

        <div className="bg-gray-50 rounded-lg p-4 space-y-3">
          <div className="flex items-center space-x-2 text-gray-700">
            <Shield className="h-5 w-5" />
            <span className="font-medium">Why we need camera access:</span>
          </div>
          <ul className="space-y-2 text-sm text-gray-600">
            <li className="flex items-start space-x-2">
              <CheckCircle className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" />
              <span>Verify your identity during the exam</span>
            </li>
            <li className="flex items-start space-x-2">
              <CheckCircle className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" />
              <span>Detect if you look away from the screen</span>
            </li>
            <li className="flex items-start space-x-2">
              <CheckCircle className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" />
              <span>Ensure no one else is helping during the exam</span>
            </li>
          </ul>
        </div>

        <Alert>
          <Info className="h-4 w-4" />
          <AlertTitle>Your Privacy Matters</AlertTitle>
          <AlertDescription>
            Camera footage is only used for exam proctoring and is not stored after the exam ends.
          </AlertDescription>
        </Alert>

        <div className="flex flex-col sm:flex-row justify-center gap-3">
          <Button 
            onClick={handleRequestPermission} 
            disabled={isRequesting}
            size="lg"
            className="min-w-[200px]"
          >
            {isRequesting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Requesting Access...
              </>
            ) : (
              <>
                <Camera className="h-4 w-4 mr-2" />
                Allow Camera Access
              </>
            )}
          </Button>
          
          {!required && onSkip && (
            <Button 
              onClick={onSkip} 
              variant="outline"
              size="lg"
            >
              Skip for Now
            </Button>
          )}
        </div>

        <button
          onClick={() => setShowInstructions(!showInstructions)}
          className="w-full text-center text-sm text-blue-600 hover:text-blue-800 underline"
        >
          Having trouble? Click here for help
        </button>

        {showInstructions && (
          <div className="bg-blue-50 rounded-lg p-4 space-y-3">
            <p className="font-medium text-blue-800">Troubleshooting Tips:</p>
            <ul className="space-y-2 text-sm text-blue-700">
              <li>• Make sure no other app is using your camera</li>
              <li>• Try refreshing the page and allowing access again</li>
              <li>• Check if your browser has camera permissions enabled</li>
              <li>• If using a laptop, check if the webcam is not covered</li>
              <li>• Try using a different browser (Chrome recommended)</li>
            </ul>
          </div>
        )}
      </div>
    );
  };

  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader className="text-center">
        <div className="flex justify-center mb-4">
          {getStatusIcon()}
        </div>
        <CardTitle className="flex items-center justify-center gap-2">
          {title}
          {getStatusBadge()}
        </CardTitle>
        <CardDescription>
          {description}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {renderContent()}
      </CardContent>
    </Card>
  );
}
