import { useState, useCallback, useRef } from "react";
import { UploadCloud } from "lucide-react";
import { cn } from "@renderer/lib/utils";
import { Card } from "./ui/card";

interface FileDropZoneProps {
  onFileSelect: (file: File) => void;
  accept?: string;
}

export function FileDropZone({ onFileSelect, accept }: FileDropZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!isDragging) setIsDragging(true);
    },
    [isDragging]
  );

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        onFileSelect(e.dataTransfer.files[0]);
      }
    },
    [onFileSelect]
  );

  const handleClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        onFileSelect(e.target.files[0]);
      }
    },
    [onFileSelect]
  );

  return (
    <Card
      className={cn(
        "w-full h-64 border-dashed border-2 flex flex-col items-center justify-center cursor-pointer transition-colors m-4 hover:bg-muted/50",
        isDragging ? "border-primary bg-primary/10" : "border-muted-foreground/25"
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={handleClick}
    >
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileInput}
        className="hidden"
        accept={accept}
      />
      <div className="flex flex-col items-center gap-2 text-center pointer-events-none">
        <UploadCloud className="h-10 w-10 text-muted-foreground" />
        <h3 className="text-lg font-semibold">Click or drag file to this area to upload (support .txt, .zip)</h3>
      </div>
    </Card>
  );
}
