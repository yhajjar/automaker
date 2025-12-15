"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { HotkeyButton } from "@/components/ui/hotkey-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CategoryAutocomplete } from "@/components/ui/category-autocomplete";
import {
  DescriptionImageDropZone,
  FeatureImagePath as DescriptionImagePath,
  ImagePreviewMap,
} from "@/components/ui/description-image-dropzone";
import { Checkbox } from "@/components/ui/checkbox";
import {
  MessageSquare,
  Settings2,
  FlaskConical,
  Plus,
  Brain,
  UserCircle,
  Zap,
  Scale,
  Cpu,
  Rocket,
  Sparkles,
} from "lucide-react";
import { cn, modelSupportsThinking } from "@/lib/utils";
import {
  Feature,
  AgentModel,
  ThinkingLevel,
  AIProfile,
} from "@/store/app-store";

type ModelOption = {
  id: AgentModel;
  label: string;
  description: string;
  badge?: string;
  provider: "claude";
};

const CLAUDE_MODELS: ModelOption[] = [
  {
    id: "haiku",
    label: "Claude Haiku",
    description: "Fast and efficient for simple tasks.",
    badge: "Speed",
    provider: "claude",
  },
  {
    id: "sonnet",
    label: "Claude Sonnet",
    description: "Balanced performance with strong reasoning.",
    badge: "Balanced",
    provider: "claude",
  },
  {
    id: "opus",
    label: "Claude Opus",
    description: "Most capable model for complex work.",
    badge: "Premium",
    provider: "claude",
  },
];

// Profile icon mapping
const PROFILE_ICONS: Record<
  string,
  React.ComponentType<{ className?: string }>
> = {
  Brain,
  Zap,
  Scale,
  Cpu,
  Rocket,
  Sparkles,
};

interface EditFeatureDialogProps {
  feature: Feature | null;
  onClose: () => void;
  onUpdate: (featureId: string, updates: {
    category: string;
    description: string;
    steps: string[];
    skipTests: boolean;
    model: AgentModel;
    thinkingLevel: ThinkingLevel;
    imagePaths: DescriptionImagePath[];
  }) => void;
  categorySuggestions: string[];
  isMaximized: boolean;
  showProfilesOnly: boolean;
  aiProfiles: AIProfile[];
}

export function EditFeatureDialog({
  feature,
  onClose,
  onUpdate,
  categorySuggestions,
  isMaximized,
  showProfilesOnly,
  aiProfiles,
}: EditFeatureDialogProps) {
  const [editingFeature, setEditingFeature] = useState<Feature | null>(feature);
  const [editFeaturePreviewMap, setEditFeaturePreviewMap] =
    useState<ImagePreviewMap>(() => new Map());
  const [showEditAdvancedOptions, setShowEditAdvancedOptions] = useState(false);

  // Update local state when feature prop changes
  useEffect(() => {
    setEditingFeature(feature);
    if (!feature) {
      setEditFeaturePreviewMap(new Map());
      setShowEditAdvancedOptions(false);
    }
  }, [feature]);

  const handleUpdate = () => {
    if (!editingFeature) return;

    const selectedModel = (editingFeature.model ?? "opus") as AgentModel;
    const normalizedThinking = modelSupportsThinking(selectedModel)
      ? editingFeature.thinkingLevel
      : "none";

    const updates = {
      category: editingFeature.category,
      description: editingFeature.description,
      steps: editingFeature.steps,
      skipTests: editingFeature.skipTests,
      model: selectedModel,
      thinkingLevel: normalizedThinking,
      imagePaths: editingFeature.imagePaths ?? [],
    };

    onUpdate(editingFeature.id, updates);
    setEditFeaturePreviewMap(new Map());
    setShowEditAdvancedOptions(false);
    onClose();
  };

  const handleDialogClose = (open: boolean) => {
    if (!open) {
      onClose();
    }
  };

  const renderModelOptions = (
    options: ModelOption[],
    selectedModel: AgentModel,
    onSelect: (model: AgentModel) => void,
    testIdPrefix = "model-select"
  ) => (
    <div className="flex gap-2 flex-wrap">
      {options.map((option) => {
        const isSelected = selectedModel === option.id;
        // Shorter display names for compact view
        const shortName = option.label.replace("Claude ", "");
        return (
          <button
            key={option.id}
            type="button"
            onClick={() => onSelect(option.id)}
            title={option.description}
            className={cn(
              "flex-1 min-w-[80px] px-3 py-2 rounded-md border text-sm font-medium transition-colors",
              isSelected
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background hover:bg-accent border-input"
            )}
            data-testid={`${testIdPrefix}-${option.id}`}
          >
            {shortName}
          </button>
        );
      })}
    </div>
  );

  const editModelAllowsThinking = modelSupportsThinking(editingFeature?.model);

  if (!editingFeature) {
    return null;
  }

  return (
    <Dialog open={!!editingFeature} onOpenChange={handleDialogClose}>
      <DialogContent
        compact={!isMaximized}
        data-testid="edit-feature-dialog"
        onPointerDownOutside={(e) => {
          // Prevent dialog from closing when clicking on category autocomplete dropdown
          const target = e.target as HTMLElement;
          if (target.closest('[data-testid="category-autocomplete-list"]')) {
            e.preventDefault();
          }
        }}
        onInteractOutside={(e) => {
          // Prevent dialog from closing when clicking on category autocomplete dropdown
          const target = e.target as HTMLElement;
          if (target.closest('[data-testid="category-autocomplete-list"]')) {
            e.preventDefault();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>Edit Feature</DialogTitle>
          <DialogDescription>Modify the feature details.</DialogDescription>
        </DialogHeader>
        <Tabs
          defaultValue="prompt"
          className="py-4 flex-1 min-h-0 flex flex-col"
        >
          <TabsList className="w-full grid grid-cols-3 mb-4">
            <TabsTrigger value="prompt" data-testid="edit-tab-prompt">
              <MessageSquare className="w-4 h-4 mr-2" />
              Prompt
            </TabsTrigger>
            <TabsTrigger value="model" data-testid="edit-tab-model">
              <Settings2 className="w-4 h-4 mr-2" />
              Model
            </TabsTrigger>
            <TabsTrigger value="testing" data-testid="edit-tab-testing">
              <FlaskConical className="w-4 h-4 mr-2" />
              Testing
            </TabsTrigger>
          </TabsList>

          {/* Prompt Tab */}
          <TabsContent value="prompt" className="space-y-4 overflow-y-auto">
            <div className="space-y-2">
              <Label htmlFor="edit-description">Description</Label>
              <DescriptionImageDropZone
                value={editingFeature.description}
                onChange={(value) =>
                  setEditingFeature({
                    ...editingFeature,
                    description: value,
                  })
                }
                images={editingFeature.imagePaths ?? []}
                onImagesChange={(images) =>
                  setEditingFeature({
                    ...editingFeature,
                    imagePaths: images,
                  })
                }
                placeholder="Describe the feature..."
                previewMap={editFeaturePreviewMap}
                onPreviewMapChange={setEditFeaturePreviewMap}
                data-testid="edit-feature-description"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-category">Category (optional)</Label>
              <CategoryAutocomplete
                value={editingFeature.category}
                onChange={(value) =>
                  setEditingFeature({
                    ...editingFeature,
                    category: value,
                  })
                }
                suggestions={categorySuggestions}
                placeholder="e.g., Core, UI, API"
                data-testid="edit-feature-category"
              />
            </div>
          </TabsContent>

          {/* Model Tab */}
          <TabsContent value="model" className="space-y-4 overflow-y-auto">
            {/* Show Advanced Options Toggle - only when profiles-only mode is enabled */}
            {showProfilesOnly && (
              <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg border border-border">
                <div className="space-y-1">
                  <p className="text-sm font-medium text-foreground">
                    Simple Mode Active
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Only showing AI profiles. Advanced model tweaking is hidden.
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setShowEditAdvancedOptions(!showEditAdvancedOptions)
                  }
                  data-testid="edit-show-advanced-options-toggle"
                >
                  <Settings2 className="w-4 h-4 mr-2" />
                  {showEditAdvancedOptions ? "Hide" : "Show"} Advanced
                </Button>
              </div>
            )}

            {/* Quick Select Profile Section */}
            {aiProfiles.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="flex items-center gap-2">
                    <UserCircle className="w-4 h-4 text-brand-500" />
                    Quick Select Profile
                  </Label>
                  <span className="text-[11px] px-2 py-0.5 rounded-full border border-brand-500/40 text-brand-500">
                    Presets
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {aiProfiles.slice(0, 6).map((profile) => {
                    const IconComponent = profile.icon
                      ? PROFILE_ICONS[profile.icon]
                      : Brain;
                    const isSelected =
                      editingFeature.model === profile.model &&
                      editingFeature.thinkingLevel === profile.thinkingLevel;
                    return (
                      <button
                        key={profile.id}
                        type="button"
                        onClick={() => {
                          setEditingFeature({
                            ...editingFeature,
                            model: profile.model,
                            thinkingLevel: profile.thinkingLevel,
                          });
                        }}
                        className={cn(
                          "flex items-center gap-2 p-2 rounded-lg border text-left transition-all",
                          isSelected
                            ? "bg-brand-500/10 border-brand-500 text-foreground"
                            : "bg-background hover:bg-accent border-input"
                        )}
                        data-testid={`edit-profile-quick-select-${profile.id}`}
                      >
                        <div className="w-7 h-7 rounded flex items-center justify-center shrink-0 bg-primary/10">
                          {IconComponent && (
                            <IconComponent className="w-4 h-4 text-primary" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate">
                            {profile.name}
                          </p>
                          <p className="text-[10px] text-muted-foreground truncate">
                            {profile.model}
                            {profile.thinkingLevel !== "none" &&
                              ` + ${profile.thinkingLevel}`}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs text-muted-foreground">
                  Or customize below.
                </p>
              </div>
            )}

            {/* Separator */}
            {aiProfiles.length > 0 &&
              (!showProfilesOnly || showEditAdvancedOptions) && (
                <div className="border-t border-border" />
              )}

            {/* Claude Models Section - Hidden when showProfilesOnly is true and showEditAdvancedOptions is false */}
            {(!showProfilesOnly || showEditAdvancedOptions) && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="flex items-center gap-2">
                    <Brain className="w-4 h-4 text-primary" />
                    Claude (SDK)
                  </Label>
                  <span className="text-[11px] px-2 py-0.5 rounded-full border border-primary/40 text-primary">
                    Native
                  </span>
                </div>
                {renderModelOptions(
                  CLAUDE_MODELS,
                  (editingFeature.model ?? "opus") as AgentModel,
                  (model) =>
                    setEditingFeature({
                      ...editingFeature,
                      model,
                      thinkingLevel: modelSupportsThinking(model)
                        ? editingFeature.thinkingLevel
                        : "none",
                    }),
                  "edit-model-select"
                )}

                {/* Thinking Level - Only shown when Claude model is selected */}
                {editModelAllowsThinking && (
                  <div className="space-y-2 pt-2 border-t border-border">
                    <Label className="flex items-center gap-2 text-sm">
                      <Brain className="w-3.5 h-3.5 text-muted-foreground" />
                      Thinking Level
                    </Label>
                    <div className="flex gap-2 flex-wrap">
                      {(
                        [
                          "none",
                          "low",
                          "medium",
                          "high",
                          "ultrathink",
                        ] as ThinkingLevel[]
                      ).map((level) => (
                        <button
                          key={level}
                          type="button"
                          onClick={() => {
                            setEditingFeature({
                              ...editingFeature,
                              thinkingLevel: level,
                            });
                          }}
                          className={cn(
                            "flex-1 px-3 py-2 rounded-md border text-sm font-medium transition-colors min-w-[60px]",
                            (editingFeature.thinkingLevel ?? "none") === level
                              ? "bg-primary text-primary-foreground border-primary"
                              : "bg-background hover:bg-accent border-input"
                          )}
                          data-testid={`edit-thinking-level-${level}`}
                        >
                          {level === "none" && "None"}
                          {level === "low" && "Low"}
                          {level === "medium" && "Med"}
                          {level === "high" && "High"}
                          {level === "ultrathink" && "Ultra"}
                        </button>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Higher levels give more time to reason through complex
                      problems.
                    </p>
                  </div>
                )}
              </div>
            )}
          </TabsContent>

          {/* Testing Tab */}
          <TabsContent value="testing" className="space-y-4 overflow-y-auto">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="edit-skip-tests"
                checked={!(editingFeature.skipTests ?? false)}
                onCheckedChange={(checked) =>
                  setEditingFeature({
                    ...editingFeature,
                    skipTests: checked !== true,
                  })
                }
                data-testid="edit-skip-tests-checkbox"
              />
              <div className="flex items-center gap-2">
                <Label
                  htmlFor="edit-skip-tests"
                  className="text-sm cursor-pointer"
                >
                  Enable automated testing
                </Label>
                <FlaskConical className="w-3.5 h-3.5 text-muted-foreground" />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              When enabled, this feature will use automated TDD. When disabled,
              it will require manual verification.
            </p>

            {/* Verification Steps - Only shown when skipTests is enabled */}
            {editingFeature.skipTests && (
              <div className="space-y-2 pt-2 border-t border-border">
                <Label>Verification Steps</Label>
                <p className="text-xs text-muted-foreground mb-2">
                  Add manual steps to verify this feature works correctly.
                </p>
                {editingFeature.steps.map((step, index) => (
                  <Input
                    key={index}
                    value={step}
                    placeholder={`Verification step ${index + 1}`}
                    onChange={(e) => {
                      const steps = [...editingFeature.steps];
                      steps[index] = e.target.value;
                      setEditingFeature({ ...editingFeature, steps });
                    }}
                    data-testid={`edit-feature-step-${index}`}
                  />
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setEditingFeature({
                      ...editingFeature,
                      steps: [...editingFeature.steps, ""],
                    })
                  }
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Add Verification Step
                </Button>
              </div>
            )}
          </TabsContent>
        </Tabs>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <HotkeyButton
            onClick={handleUpdate}
            hotkey={{ key: "Enter", cmdCtrl: true }}
            hotkeyActive={!!editingFeature}
            data-testid="confirm-edit-feature"
          >
            Save Changes
          </HotkeyButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
