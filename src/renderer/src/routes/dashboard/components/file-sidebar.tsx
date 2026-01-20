import { useState } from "react";
import { Badge } from "@renderer/components/ui/badge";
import { ScrollArea } from "@renderer/components/ui/scroll-area";
import { cn } from "@renderer/lib/utils";
import { ChevronDown, ChevronRight } from "lucide-react";

interface FileSidebarProps {
  files: string[];
  logStructure: Record<string, string[]>;
  selectedFileName: string | null;
  activeFile: string | null;
  onSelectFile: (fileName: string) => void;
  onScrollToSection: (key: string) => void;
}

const FileItem = ({
  fileName,
  sections,
  selectedFileName,
  activeFile,
  onSelectFile,
  onScrollToSection
}: {
  fileName: string;
  sections: string[];
  selectedFileName: string | null;
  activeFile: string | null;
  onSelectFile: (fileName: string) => void;
  onScrollToSection: (key: string) => void;
}) => {
  const [isOpen, setIsOpen] = useState(true); // Default expanded

  return (
    <div className="mb-1">
      <div
        className={cn(
          "flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-fill-component-navigation transition-colors group select-none cursor-pointer"
        )}
        onClick={() => {
          if (fileName !== selectedFileName) {
            onSelectFile(fileName);
          }
        }}
      >
        <button
          onClick={(e) => {
            e.stopPropagation();
            setIsOpen(!isOpen);
          }}
          className="p-0.5 hover:bg-fill-interaction-subtle-hover rounded text-muted-foreground hover:text-foreground transition-colors"
        >
          {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>

        <span className="text-sm font-semibold truncate flex-1" title={fileName}>
          {fileName}
        </span>
        <Badge variant="outline" className="text-[10px] h-5 px-1 ml-auto">
          {sections.length}
        </Badge>
      </div>

      {isOpen && (
        <div className="ml-6 pl-2 border-l border-border/20 flex flex-col gap-0.5 mt-1">
          {sections.map((sectionKey) => {
            // sectionKey is "FileName::SectionName"
            // We display only "SectionName"
            const parts = sectionKey.split("::");
            const displayName = parts.length > 1 ? parts.slice(1).join("::") : sectionKey;

            const isActive =
              activeFile === sectionKey ||
              (selectedFileName === fileName && sectionKey === activeFile);

            return (
              <div
                key={sectionKey}
                className={cn(
                  "flex items-center gap-2 rounded-md px-2 py-1 hover:bg-fill-component-navigation transition-colors cursor-pointer",
                  isActive && "bg-fill-component-navigation text-primary"
                )}
                onClick={(e) => {
                  e.stopPropagation();
                  onScrollToSection(sectionKey);
                }}
              >
                <span
                  className={cn(
                    "text-xs text-left truncate flex-1 opacity-80 hover:opacity-100",
                    isActive && "font-medium opacity-100"
                  )}
                  title={displayName}
                >
                  {displayName}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export const FileSidebar = ({
  files,
  logStructure,
  selectedFileName,
  activeFile,
  onSelectFile,
  onScrollToSection
}: FileSidebarProps) => {
  return (
    <div className="w-64 border-r bg-muted/20 shrink-0 flex flex-col">
      <div className="p-3 bg-muted/30 font-semibold text-sm border-b flex items-center justify-between">
        <span>Log Files ({files.length})</span>
      </div>
      <ScrollArea className="h-[calc(100vh-140px)] scrollbar-container">
        <div className="p-2 flex flex-col gap-1">
          {files.map((fileName) => (
            <FileItem
              key={fileName}
              fileName={fileName}
              sections={logStructure[fileName]}
              selectedFileName={selectedFileName}
              activeFile={activeFile}
              onSelectFile={onSelectFile}
              onScrollToSection={onScrollToSection}
            />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
};
