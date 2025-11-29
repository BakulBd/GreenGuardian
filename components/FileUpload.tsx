"use client";

import { useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { 
  Upload, 
  X, 
  File, 
  FileText, 
  Image as ImageIcon, 
  Loader2,
  CheckCircle,
  AlertTriangle
} from "lucide-react";
import { 
  uploadFile, 
  validateFile, 
  formatFileSize,
  UploadResult,
  UploadProgress,
  EXAM_PAPER_ALLOWED_TYPES,
  MAX_FILE_SIZE
} from "@/lib/firebase/storage";
import { cn } from "@/lib/utils";

interface FileUploadProps {
  onUploadComplete: (files: UploadResult[]) => void;
  basePath: string;
  maxFiles?: number;
  allowedTypes?: string[];
  maxSize?: number;
  className?: string;
  accept?: string;
  disabled?: boolean;
}

interface UploadingFile {
  file: File;
  progress: number;
  status: "uploading" | "success" | "error";
  error?: string;
  result?: UploadResult;
}

export default function FileUpload({
  onUploadComplete,
  basePath,
  maxFiles = 5,
  allowedTypes = EXAM_PAPER_ALLOWED_TYPES,
  maxSize = MAX_FILE_SIZE,
  className,
  accept = ".pdf,.doc,.docx,.jpg,.jpeg,.png,.webp",
  disabled = false,
}: FileUploadProps) {
  const [uploadingFiles, setUploadingFiles] = useState<UploadingFile[]>([]);
  const [uploadedFiles, setUploadedFiles] = useState<UploadResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setError(null);

    const fileArray = Array.from(files);
    
    // Check max files
    if (uploadedFiles.length + fileArray.length > maxFiles) {
      setError(`Maximum ${maxFiles} files allowed. You already have ${uploadedFiles.length} files.`);
      return;
    }

    // Validate all files first
    for (const file of fileArray) {
      const validation = validateFile(file, allowedTypes, maxSize);
      if (!validation.isValid) {
        setError(`${file.name}: ${validation.error}`);
        return;
      }
    }

    // Start uploading
    const newUploadingFiles: UploadingFile[] = fileArray.map(file => ({
      file,
      progress: 0,
      status: "uploading" as const,
    }));

    setUploadingFiles(prev => [...prev, ...newUploadingFiles]);

    const results: UploadResult[] = [];

    for (let i = 0; i < fileArray.length; i++) {
      const file = fileArray[i];
      const timestamp = Date.now();
      const sanitizedName = file.name.replace(/[^a-zA-Z0-9.-]/g, "_");
      const path = `${basePath}/${timestamp}_${sanitizedName}`;

      try {
        const result = await uploadFile(file, path, (progress) => {
          setUploadingFiles(prev => 
            prev.map(f => 
              f.file === file 
                ? { ...f, progress: progress.progress } 
                : f
            )
          );
        });

        results.push(result);
        
        setUploadingFiles(prev => 
          prev.map(f => 
            f.file === file 
              ? { ...f, status: "success", result } 
              : f
          )
        );
      } catch (err: any) {
        setUploadingFiles(prev => 
          prev.map(f => 
            f.file === file 
              ? { ...f, status: "error", error: err.message || "Upload failed" } 
              : f
          )
        );
      }
    }

    // Add successful uploads to uploaded files
    if (results.length > 0) {
      const newUploaded = [...uploadedFiles, ...results];
      setUploadedFiles(newUploaded);
      onUploadComplete(newUploaded);
    }

    // Clear completed uploads after a delay
    setTimeout(() => {
      setUploadingFiles(prev => prev.filter(f => f.status === "uploading"));
    }, 2000);

  }, [basePath, uploadedFiles, maxFiles, allowedTypes, maxSize, onUploadComplete]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (!disabled) {
      handleFiles(e.dataTransfer.files);
    }
  }, [handleFiles, disabled]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (!disabled) {
      setIsDragging(true);
    }
  }, [disabled]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const removeFile = (index: number) => {
    const newFiles = uploadedFiles.filter((_, i) => i !== index);
    setUploadedFiles(newFiles);
    onUploadComplete(newFiles);
  };

  const getFileIcon = (type: string) => {
    if (type.startsWith("image/")) {
      return <ImageIcon className="h-4 w-4" />;
    }
    if (type.includes("pdf")) {
      return <FileText className="h-4 w-4 text-red-500" />;
    }
    if (type.includes("word") || type.includes("document")) {
      return <FileText className="h-4 w-4 text-blue-500" />;
    }
    return <File className="h-4 w-4" />;
  };

  return (
    <div className={cn("space-y-4", className)}>
      {/* Drop Zone */}
      <div
        className={cn(
          "relative border-2 border-dashed rounded-lg p-6 text-center transition-colors",
          isDragging 
            ? "border-green-500 bg-green-50" 
            : "border-gray-300 hover:border-gray-400",
          disabled && "opacity-50 cursor-not-allowed"
        )}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={accept}
          onChange={(e) => handleFiles(e.target.files)}
          className="hidden"
          disabled={disabled}
        />
        
        <Upload className="mx-auto h-10 w-10 text-gray-400 mb-3" />
        
        <p className="text-sm text-gray-600">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="text-green-600 hover:text-green-700 font-medium"
            disabled={disabled}
          >
            Click to upload
          </button>
          {" "}or drag and drop
        </p>
        
        <p className="text-xs text-gray-500 mt-1">
          PDF, Word, or Images up to {formatFileSize(maxSize)}
        </p>
        
        <p className="text-xs text-gray-400 mt-1">
          Max {maxFiles} files
        </p>
      </div>

      {/* Error Message */}
      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Uploading Files */}
      {uploadingFiles.length > 0 && (
        <div className="space-y-2">
          {uploadingFiles.map((item, index) => (
            <div 
              key={`uploading-${index}`}
              className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg"
            >
              {item.status === "uploading" && (
                <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
              )}
              {item.status === "success" && (
                <CheckCircle className="h-4 w-4 text-green-500" />
              )}
              {item.status === "error" && (
                <AlertTriangle className="h-4 w-4 text-red-500" />
              )}
              
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{item.file.name}</p>
                {item.status === "uploading" && (
                  <Progress value={item.progress} className="h-1 mt-1" />
                )}
                {item.status === "error" && (
                  <p className="text-xs text-red-500">{item.error}</p>
                )}
              </div>
              
              <span className="text-xs text-gray-500">
                {formatFileSize(item.file.size)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Uploaded Files */}
      {uploadedFiles.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-gray-700">
            Uploaded Files ({uploadedFiles.length})
          </p>
          {uploadedFiles.map((file, index) => (
            <div 
              key={`uploaded-${index}`}
              className="flex items-center gap-3 p-3 bg-green-50 border border-green-200 rounded-lg"
            >
              {getFileIcon(file.type)}
              
              <div className="flex-1 min-w-0">
                <a
                  href={file.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium text-green-700 hover:text-green-800 truncate block"
                >
                  {file.name}
                </a>
              </div>
              
              <span className="text-xs text-gray-500">
                {formatFileSize(file.size)}
              </span>
              
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => removeFile(index)}
                className="text-gray-400 hover:text-red-500"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
