"use client";

import { useEffect, useState, useCallback } from "react";
import { useAppStore } from "@/store/app-store";
import { getElectronAPI } from "@/lib/electron";
import { Button } from "@/components/ui/button";
import { HotkeyButton } from "@/components/ui/hotkey-button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Save, RefreshCw, FileText, Sparkles, Loader2, FilePlus2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { XmlSyntaxEditor } from "@/components/ui/xml-syntax-editor";
import type { SpecRegenerationEvent } from "@/types/electron";

export function SpecView() {
  const { currentProject, appSpec, setAppSpec } = useAppStore();
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [specExists, setSpecExists] = useState(true);

  // Regeneration state
  const [showRegenerateDialog, setShowRegenerateDialog] = useState(false);
  const [projectDefinition, setProjectDefinition] = useState("");
  const [isRegenerating, setIsRegenerating] = useState(false);

  // Create spec state
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [projectOverview, setProjectOverview] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [generateFeatures, setGenerateFeatures] = useState(true);

  // Load spec from file
  const loadSpec = useCallback(async () => {
    if (!currentProject) return;

    setIsLoading(true);
    try {
      const api = getElectronAPI();
      const result = await api.readFile(
        `${currentProject.path}/.automaker/app_spec.txt`
      );

      if (result.success && result.content) {
        setAppSpec(result.content);
        setSpecExists(true);
        setHasChanges(false);
      } else {
        // File doesn't exist
        setAppSpec("");
        setSpecExists(false);
      }
    } catch (error) {
      console.error("Failed to load spec:", error);
      setSpecExists(false);
    } finally {
      setIsLoading(false);
    }
  }, [currentProject, setAppSpec]);

  useEffect(() => {
    loadSpec();
  }, [loadSpec]);

  // Subscribe to spec regeneration events
  useEffect(() => {
    const api = getElectronAPI();
    if (!api.specRegeneration) return;

    const unsubscribe = api.specRegeneration.onEvent((event: SpecRegenerationEvent) => {
      console.log("[SpecView] Regeneration event:", event.type);

      if (event.type === "spec_regeneration_complete") {
        setIsRegenerating(false);
        setIsCreating(false);
        setShowRegenerateDialog(false);
        setShowCreateDialog(false);
        setProjectDefinition("");
        setProjectOverview("");
        // Reload the spec to show the new content
        loadSpec();
      } else if (event.type === "spec_regeneration_error") {
        setIsRegenerating(false);
        setIsCreating(false);
        console.error("[SpecView] Regeneration error:", event.error);
      }
    });

    return () => {
      unsubscribe();
    };
  }, [loadSpec]);

  // Save spec to file
  const saveSpec = async () => {
    if (!currentProject) return;

    setIsSaving(true);
    try {
      const api = getElectronAPI();
      await api.writeFile(
        `${currentProject.path}/.automaker/app_spec.txt`,
        appSpec
      );
      setHasChanges(false);
    } catch (error) {
      console.error("Failed to save spec:", error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleChange = (value: string) => {
    setAppSpec(value);
    setHasChanges(true);
  };

  const handleRegenerate = async () => {
    if (!currentProject || !projectDefinition.trim()) return;

    setIsRegenerating(true);
    try {
      const api = getElectronAPI();
      if (!api.specRegeneration) {
        console.error("[SpecView] Spec regeneration not available");
        setIsRegenerating(false);
        return;
      }
      const result = await api.specRegeneration.generate(
        currentProject.path,
        projectDefinition.trim()
      );

      if (!result.success) {
        console.error("[SpecView] Failed to start regeneration:", result.error);
        setIsRegenerating(false);
      }
      // If successful, we'll wait for the events to update the state
    } catch (error) {
      console.error("[SpecView] Failed to regenerate spec:", error);
      setIsRegenerating(false);
    }
  };

  const handleCreateSpec = async () => {
    if (!currentProject || !projectOverview.trim()) return;

    setIsCreating(true);
    setShowCreateDialog(false);
    try {
      const api = getElectronAPI();
      if (!api.specRegeneration) {
        console.error("[SpecView] Spec regeneration not available");
        setIsCreating(false);
        return;
      }
      const result = await api.specRegeneration.create(
        currentProject.path,
        projectOverview.trim(),
        generateFeatures
      );

      if (!result.success) {
        console.error("[SpecView] Failed to start spec creation:", result.error);
        setIsCreating(false);
      }
      // If successful, we'll wait for the events to update the state
    } catch (error) {
      console.error("[SpecView] Failed to create spec:", error);
      setIsCreating(false);
    }
  };

  if (!currentProject) {
    return (
      <div
        className="flex-1 flex items-center justify-center"
        data-testid="spec-view-no-project"
      >
        <p className="text-muted-foreground">No project selected</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div
        className="flex-1 flex items-center justify-center"
        data-testid="spec-view-loading"
      >
        <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Show empty state when no spec exists (isCreating is handled by bottom-right indicator in sidebar)
  if (!specExists) {
    return (
      <div
        className="flex-1 flex flex-col overflow-hidden content-bg"
        data-testid="spec-view-empty"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border bg-glass backdrop-blur-md">
          <div className="flex items-center gap-3">
            <FileText className="w-5 h-5 text-muted-foreground" />
            <div>
              <h1 className="text-xl font-bold">App Specification</h1>
              <p className="text-sm text-muted-foreground">
                {currentProject.path}/.automaker/app_spec.txt
              </p>
            </div>
          </div>
        </div>

        {/* Empty State */}
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="text-center max-w-md">
            <div className="mb-6 flex justify-center">
              <div className="p-4 rounded-full bg-primary/10">
                <FilePlus2 className="w-12 h-12 text-primary" />
              </div>
            </div>
            <h2 className="text-2xl font-semibold mb-3">No App Specification Found</h2>
            <p className="text-muted-foreground mb-6">
              Create an app specification to help our system understand your project.
              We&apos;ll analyze your codebase and generate a comprehensive spec based on your description.
            </p>
            <Button
              size="lg"
              onClick={() => setShowCreateDialog(true)}
            >
              <FilePlus2 className="w-5 h-5 mr-2" />
              Create app_spec
            </Button>
          </div>
        </div>

        {/* Create Dialog */}
        <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Create App Specification</DialogTitle>
              <DialogDescription className="text-muted-foreground">
                We didn&apos;t find an app_spec.txt file. Let us help you generate your app_spec.txt
                to help describe your project for our system. We&apos;ll analyze your project&apos;s
                tech stack and create a comprehensive specification.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">
                  Project Overview
                </label>
                <p className="text-xs text-muted-foreground">
                  Describe what your project does and what features you want to build.
                  Be as detailed as you want - this will help us create a better specification.
                </p>
                <textarea
                  className="w-full h-48 p-3 rounded-md border border-border bg-background font-mono text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                  value={projectOverview}
                  onChange={(e) => setProjectOverview(e.target.value)}
                  placeholder="e.g., A project management tool that allows teams to track tasks, manage sprints, and visualize progress through kanban boards. It should support user authentication, real-time updates, and file attachments..."
                  autoFocus
                />
              </div>

              <div className="flex items-start space-x-3 pt-2">
                <Checkbox
                  id="generate-features"
                  checked={generateFeatures}
                  onCheckedChange={(checked) => setGenerateFeatures(checked === true)}
                />
                <div className="space-y-1">
                  <label
                    htmlFor="generate-features"
                    className="text-sm font-medium cursor-pointer"
                  >
                    Generate feature list
                  </label>
                  <p className="text-xs text-muted-foreground">
                    Automatically populate feature_list.json with all features from the
                    implementation roadmap after the spec is generated.
                  </p>
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button
                variant="ghost"
                onClick={() => setShowCreateDialog(false)}
              >
                Cancel
              </Button>
              <HotkeyButton
                onClick={handleCreateSpec}
                disabled={!projectOverview.trim()}
                hotkey={{ key: "Enter", cmdCtrl: true }}
                hotkeyActive={showCreateDialog}
              >
                <Sparkles className="w-4 h-4 mr-2" />
                Generate Spec
              </HotkeyButton>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  return (
    <div
      className="flex-1 flex flex-col overflow-hidden content-bg"
      data-testid="spec-view"
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border bg-glass backdrop-blur-md">
        <div className="flex items-center gap-3">
          <FileText className="w-5 h-5 text-muted-foreground" />
          <div>
            <h1 className="text-xl font-bold">App Specification</h1>
            <p className="text-sm text-muted-foreground">
              {currentProject.path}/.automaker/app_spec.txt
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowRegenerateDialog(true)}
            disabled={isRegenerating}
            data-testid="regenerate-spec"
          >
            {isRegenerating ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Sparkles className="w-4 h-4 mr-2" />
            )}
            {isRegenerating ? "Regenerating..." : "Regenerate"}
          </Button>
          <Button
            size="sm"
            onClick={saveSpec}
            disabled={!hasChanges || isSaving}
            data-testid="save-spec"
          >
            <Save className="w-4 h-4 mr-2" />
            {isSaving ? "Saving..." : hasChanges ? "Save Changes" : "Saved"}
          </Button>
        </div>
      </div>

      {/* Editor */}
      <div className="flex-1 p-4 overflow-hidden">
        <Card className="h-full overflow-hidden">
          <XmlSyntaxEditor
            value={appSpec}
            onChange={handleChange}
            placeholder="Write your app specification here..."
            data-testid="spec-editor"
          />
        </Card>
      </div>

      {/* Regenerate Dialog */}
      <Dialog open={showRegenerateDialog} onOpenChange={setShowRegenerateDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Regenerate App Specification</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              We will regenerate your app spec based on a short project definition and the
              current tech stack found in your project. The agent will analyze your codebase
              to understand your existing technologies and create a comprehensive specification.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">
                Describe your project
              </label>
              <p className="text-xs text-muted-foreground">
                Provide a clear description of what your app should do. Be as detailed as you
                want - the more context you provide, the more comprehensive the spec will be.
              </p>
              <textarea
                className="w-full h-40 p-3 rounded-md border border-border bg-background font-mono text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                value={projectDefinition}
                onChange={(e) => setProjectDefinition(e.target.value)}
                placeholder="e.g., A task management app where users can create projects, add tasks with due dates, assign tasks to team members, track progress with a kanban board, and receive notifications for upcoming deadlines..."
                disabled={isRegenerating}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setShowRegenerateDialog(false)}
              disabled={isRegenerating}
            >
              Cancel
            </Button>
            <HotkeyButton
              onClick={handleRegenerate}
              disabled={!projectDefinition.trim() || isRegenerating}
              hotkey={{ key: "Enter", cmdCtrl: true }}
              hotkeyActive={showRegenerateDialog}
            >
              {isRegenerating ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Regenerating...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 mr-2" />
                  Regenerate Spec
                </>
              )}
            </HotkeyButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
