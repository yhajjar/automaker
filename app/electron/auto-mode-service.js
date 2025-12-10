const featureLoader = require("./services/feature-loader");
const featureExecutor = require("./services/feature-executor");
const featureVerifier = require("./services/feature-verifier");
const contextManager = require("./services/context-manager");
const projectAnalyzer = require("./services/project-analyzer");
const worktreeManager = require("./services/worktree-manager");

/**
 * Auto Mode Service - Autonomous feature implementation
 * Automatically picks and implements features from the kanban board
 *
 * This service acts as the main orchestrator, delegating work to specialized services:
 * - featureLoader: Loading and selecting features
 * - featureExecutor: Implementing features
 * - featureVerifier: Running tests and verification
 * - contextManager: Managing context files
 * - projectAnalyzer: Analyzing project structure
 */
class AutoModeService {
  constructor() {
    // Track multiple concurrent feature executions
    this.runningFeatures = new Map(); // featureId -> { abortController, query, projectPath, sendToRenderer }
    this.autoLoopRunning = false; // Separate flag for the auto loop
    this.autoLoopAbortController = null;
    this.autoLoopInterval = null; // Timer for periodic checking
    this.checkIntervalMs = 5000; // Check every 5 seconds
    this.maxConcurrency = 3; // Default max concurrency
  }

  /**
   * Helper to create execution context with isActive check
   */
  createExecutionContext(featureId) {
    const context = {
      abortController: null,
      query: null,
      projectPath: null, // Original project path
      worktreePath: null, // Path to worktree (where agent works)
      branchName: null, // Feature branch name
      sendToRenderer: null,
      isActive: () => this.runningFeatures.has(featureId),
    };
    return context;
  }

  /**
   * Setup worktree for a feature
   * Creates an isolated git worktree where the agent can work
   * @param {Object} feature - The feature object
   * @param {string} projectPath - Path to the project
   * @param {Function} sendToRenderer - Function to send events to the renderer
   * @param {boolean} useWorktreesEnabled - Whether worktrees are enabled in settings (default: false)
   */
  async setupWorktreeForFeature(feature, projectPath, sendToRenderer, useWorktreesEnabled = false) {
    // If worktrees are disabled in settings, skip entirely
    if (!useWorktreesEnabled) {
      console.log(`[AutoMode] Worktrees disabled in settings, working directly on main project`);
      return { useWorktree: false, workPath: projectPath };
    }

    // Check if worktrees are enabled (project must be a git repo)
    const isGit = await worktreeManager.isGitRepo(projectPath);
    if (!isGit) {
      console.log(`[AutoMode] Project is not a git repo, skipping worktree creation`);
      return { useWorktree: false, workPath: projectPath };
    }

    sendToRenderer({
      type: "auto_mode_progress",
      featureId: feature.id,
      content: "Creating isolated worktree for feature...\n",
    });

    const result = await worktreeManager.createWorktree(projectPath, feature);

    if (!result.success) {
      console.warn(`[AutoMode] Failed to create worktree: ${result.error}. Falling back to main project.`);
      sendToRenderer({
        type: "auto_mode_progress",
        featureId: feature.id,
        content: `Warning: Could not create worktree (${result.error}). Working directly on main project.\n`,
      });
      return { useWorktree: false, workPath: projectPath };
    }

    console.log(`[AutoMode] Created worktree at: ${result.worktreePath}, branch: ${result.branchName}`);
    sendToRenderer({
      type: "auto_mode_progress",
      featureId: feature.id,
      content: `Working in isolated branch: ${result.branchName}\n`,
    });

    // Update feature with worktree info in feature_list.json
    await featureLoader.updateFeatureWorktree(
      feature.id,
      projectPath,
      result.worktreePath,
      result.branchName
    );

    return {
      useWorktree: true,
      workPath: result.worktreePath,
      branchName: result.branchName,
      baseBranch: result.baseBranch,
    };
  }

  /**
   * Start auto mode - continuously implement features
   */
  async start({ projectPath, sendToRenderer, maxConcurrency }) {
    if (this.autoLoopRunning) {
      throw new Error("Auto mode loop is already running");
    }

    this.autoLoopRunning = true;
    this.maxConcurrency = maxConcurrency || 3;

    console.log(
      `[AutoMode] Starting auto mode for project: ${projectPath} with max concurrency: ${this.maxConcurrency}`
    );

    // Start the periodic checking loop
    this.runPeriodicLoop(projectPath, sendToRenderer);

    return { success: true };
  }

  /**
   * Stop auto mode - stops the auto loop but lets running features complete
   * This only turns off the auto toggle to prevent picking up new features.
   * Running tasks will continue until they complete naturally.
   */
  async stop() {
    console.log("[AutoMode] Stopping auto mode (letting running features complete)");

    this.autoLoopRunning = false;

    // Clear the interval timer
    if (this.autoLoopInterval) {
      clearInterval(this.autoLoopInterval);
      this.autoLoopInterval = null;
    }

    // Abort auto loop if running
    if (this.autoLoopAbortController) {
      this.autoLoopAbortController.abort();
      this.autoLoopAbortController = null;
    }

    // NOTE: We intentionally do NOT abort running features here.
    // Stopping auto mode should only turn off the toggle to prevent new features
    // from being picked up. Running features will complete naturally.
    // Use stopFeature() to cancel a specific running feature if needed.

    const runningCount = this.runningFeatures.size;
    console.log(`[AutoMode] Auto loop stopped. ${runningCount} feature(s) still running and will complete.`);

    return { success: true, runningFeatures: runningCount };
  }

  /**
   * Get status of auto mode
   */
  getStatus() {
    return {
      autoLoopRunning: this.autoLoopRunning,
      runningFeatures: Array.from(this.runningFeatures.keys()),
      runningCount: this.runningFeatures.size,
    };
  }

  /**
   * Run a specific feature by ID
   * @param {string} projectPath - Path to the project
   * @param {string} featureId - ID of the feature to run
   * @param {Function} sendToRenderer - Function to send events to renderer
   * @param {boolean} useWorktrees - Whether to use git worktree isolation (default: false)
   */
  async runFeature({ projectPath, featureId, sendToRenderer, useWorktrees = false }) {
    // Check if this specific feature is already running
    if (this.runningFeatures.has(featureId)) {
      throw new Error(`Feature ${featureId} is already running`);
    }

    console.log(`[AutoMode] Running specific feature: ${featureId} (worktrees: ${useWorktrees})`);

    // Register this feature as running
    const execution = this.createExecutionContext(featureId);
    execution.projectPath = projectPath;
    execution.sendToRenderer = sendToRenderer;
    this.runningFeatures.set(featureId, execution);

    try {
      // Load features
      const features = await featureLoader.loadFeatures(projectPath);
      const feature = features.find((f) => f.id === featureId);

      if (!feature) {
        throw new Error(`Feature ${featureId} not found`);
      }

      console.log(`[AutoMode] Running feature: ${feature.description}`);

      // Setup worktree for isolated work (if enabled)
      const worktreeSetup = await this.setupWorktreeForFeature(feature, projectPath, sendToRenderer, useWorktrees);
      execution.worktreePath = worktreeSetup.workPath;
      execution.branchName = worktreeSetup.branchName;

      // Determine working path (worktree or main project)
      const workPath = worktreeSetup.workPath;

      // Update feature status to in_progress
      await featureLoader.updateFeatureStatus(
        featureId,
        "in_progress",
        projectPath
      );

      sendToRenderer({
        type: "auto_mode_feature_start",
        featureId: feature.id,
        feature: { ...feature, worktreePath: worktreeSetup.workPath, branchName: worktreeSetup.branchName },
      });

      // Implement the feature (agent works in worktree)
      const result = await featureExecutor.implementFeature(
        feature,
        workPath, // Use worktree path instead of main project
        sendToRenderer,
        execution
      );

      // Update feature status based on result
      // For skipTests features, go to waiting_approval on success instead of verified
      // On failure, ALL features go to waiting_approval so user can review and decide next steps
      // This prevents infinite retry loops when the same issue keeps failing
      let newStatus;
      if (result.passes) {
        newStatus = feature.skipTests ? "waiting_approval" : "verified";
      } else {
        // On failure, go to waiting_approval for user review
        // Don't automatically move back to backlog to avoid infinite retry loops
        // (especially when hitting rate limits or persistent errors)
        newStatus = "waiting_approval";
      }
      await featureLoader.updateFeatureStatus(
        feature.id,
        newStatus,
        projectPath
      );

      // Keep context file for viewing output later (deleted only when card is removed)

      sendToRenderer({
        type: "auto_mode_feature_complete",
        featureId: feature.id,
        passes: result.passes,
        message: result.message,
      });

      return { success: true, passes: result.passes };
    } catch (error) {
      console.error("[AutoMode] Error running feature:", error);

      // Write error to context file
      try {
        await contextManager.writeToContextFile(
          projectPath,
          featureId,
          `\n\n❌ ERROR: ${error.message}\n\n${error.stack || ''}\n`
        );
      } catch (contextError) {
        console.error("[AutoMode] Failed to write error to context:", contextError);
      }

      // Update feature status to waiting_approval so user can review the error
      try {
        await featureLoader.updateFeatureStatus(
          featureId,
          "waiting_approval",
          projectPath,
          null, // no summary
          error.message // pass error message
        );
      } catch (statusError) {
        console.error("[AutoMode] Failed to update feature status after error:", statusError);
      }

      sendToRenderer({
        type: "auto_mode_error",
        error: error.message,
        featureId: featureId,
      });
      throw error;
    } finally {
      // Clean up this feature's execution
      this.runningFeatures.delete(featureId);
    }
  }

  /**
   * Verify a specific feature by running its tests
   */
  async verifyFeature({ projectPath, featureId, sendToRenderer }) {
    console.log(`[AutoMode] verifyFeature called with:`, {
      projectPath,
      featureId,
    });

    // Check if this specific feature is already running
    if (this.runningFeatures.has(featureId)) {
      throw new Error(`Feature ${featureId} is already running`);
    }

    console.log(`[AutoMode] Verifying feature: ${featureId}`);

    // Register this feature as running
    const execution = this.createExecutionContext(featureId);
    execution.projectPath = projectPath;
    execution.sendToRenderer = sendToRenderer;
    this.runningFeatures.set(featureId, execution);

    try {
      // Load features
      const features = await featureLoader.loadFeatures(projectPath);
      const feature = features.find((f) => f.id === featureId);

      if (!feature) {
        throw new Error(`Feature ${featureId} not found`);
      }

      console.log(`[AutoMode] Verifying feature: ${feature.description}`);

      sendToRenderer({
        type: "auto_mode_feature_start",
        featureId: feature.id,
        feature: feature,
      });

      // Verify the feature by running tests
      const result = await featureVerifier.verifyFeatureTests(
        feature,
        projectPath,
        sendToRenderer,
        execution
      );

      // Update feature status based on result
      const newStatus = result.passes ? "verified" : "in_progress";
      await featureLoader.updateFeatureStatus(
        featureId,
        newStatus,
        projectPath
      );

      // Keep context file for viewing output later (deleted only when card is removed)

      sendToRenderer({
        type: "auto_mode_feature_complete",
        featureId: feature.id,
        passes: result.passes,
        message: result.message,
      });

      return { success: true, passes: result.passes };
    } catch (error) {
      console.error("[AutoMode] Error verifying feature:", error);

      // Write error to context file
      try {
        await contextManager.writeToContextFile(
          projectPath,
          featureId,
          `\n\n❌ ERROR: ${error.message}\n\n${error.stack || ''}\n`
        );
      } catch (contextError) {
        console.error("[AutoMode] Failed to write error to context:", contextError);
      }

      // Update feature status to waiting_approval so user can review the error
      try {
        await featureLoader.updateFeatureStatus(
          featureId,
          "waiting_approval",
          projectPath,
          null, // no summary
          error.message // pass error message
        );
      } catch (statusError) {
        console.error("[AutoMode] Failed to update feature status after error:", statusError);
      }

      sendToRenderer({
        type: "auto_mode_error",
        error: error.message,
        featureId: featureId,
      });
      throw error;
    } finally {
      // Clean up this feature's execution
      this.runningFeatures.delete(featureId);
    }
  }

  /**
   * Resume a feature that has previous context - loads existing context and continues implementation
   */
  async resumeFeature({ projectPath, featureId, sendToRenderer }) {
    console.log(`[AutoMode] resumeFeature called with:`, {
      projectPath,
      featureId,
    });

    // Check if this specific feature is already running
    if (this.runningFeatures.has(featureId)) {
      throw new Error(`Feature ${featureId} is already running`);
    }

    console.log(`[AutoMode] Resuming feature: ${featureId}`);

    // Register this feature as running
    const execution = this.createExecutionContext(featureId);
    execution.projectPath = projectPath;
    execution.sendToRenderer = sendToRenderer;
    this.runningFeatures.set(featureId, execution);

    try {
      // Load features
      const features = await featureLoader.loadFeatures(projectPath);
      const feature = features.find((f) => f.id === featureId);

      if (!feature) {
        throw new Error(`Feature ${featureId} not found`);
      }

      console.log(`[AutoMode] Resuming feature: ${feature.description}`);

      sendToRenderer({
        type: "auto_mode_feature_start",
        featureId: feature.id,
        feature: feature,
      });

      // Read existing context
      const previousContext = await contextManager.readContextFile(
        projectPath,
        featureId
      );

      // Resume implementation with context
      const result = await featureExecutor.resumeFeatureWithContext(
        feature,
        projectPath,
        sendToRenderer,
        previousContext,
        execution
      );

      // If the agent ends early without finishing, automatically re-run
      let attempts = 0;
      const maxAttempts = 3;
      let finalResult = result;

      while (!finalResult.passes && attempts < maxAttempts) {
        // Check if feature is still in progress (not verified)
        const updatedFeatures = await featureLoader.loadFeatures(projectPath);
        const updatedFeature = updatedFeatures.find((f) => f.id === featureId);

        if (updatedFeature && updatedFeature.status === "in_progress") {
          attempts++;
          console.log(
            `[AutoMode] Feature ended early, auto-retrying (attempt ${attempts}/${maxAttempts})...`
          );

          // Update context file with retry message
          await contextManager.writeToContextFile(
            projectPath,
            featureId,
            `\n\n🔄 Auto-retry #${attempts} - Continuing implementation...\n\n`
          );

          sendToRenderer({
            type: "auto_mode_progress",
            featureId: feature.id,
            content: `\n🔄 Auto-retry #${attempts} - Agent ended early, continuing...\n`,
          });

          // Read updated context
          const retryContext = await contextManager.readContextFile(
            projectPath,
            featureId
          );

          // Resume again with full context
          finalResult = await featureExecutor.resumeFeatureWithContext(
            feature,
            projectPath,
            sendToRenderer,
            retryContext,
            execution
          );
        } else {
          break;
        }
      }

      // Update feature status based on final result
      // For skipTests features, go to waiting_approval on success instead of verified
      // On failure, go to waiting_approval so user can review and decide next steps
      let newStatus;
      if (finalResult.passes) {
        newStatus = feature.skipTests ? "waiting_approval" : "verified";
      } else {
        // On failure after all retry attempts, go to waiting_approval for user review
        newStatus = "waiting_approval";
      }
      await featureLoader.updateFeatureStatus(
        featureId,
        newStatus,
        projectPath
      );

      // Keep context file for viewing output later (deleted only when card is removed)

      sendToRenderer({
        type: "auto_mode_feature_complete",
        featureId: feature.id,
        passes: finalResult.passes,
        message: finalResult.message,
      });

      return { success: true, passes: finalResult.passes };
    } catch (error) {
      console.error("[AutoMode] Error resuming feature:", error);

      // Write error to context file
      try {
        await contextManager.writeToContextFile(
          projectPath,
          featureId,
          `\n\n❌ ERROR: ${error.message}\n\n${error.stack || ''}\n`
        );
      } catch (contextError) {
        console.error("[AutoMode] Failed to write error to context:", contextError);
      }

      // Update feature status to waiting_approval so user can review the error
      try {
        await featureLoader.updateFeatureStatus(
          featureId,
          "waiting_approval",
          projectPath,
          null, // no summary
          error.message // pass error message
        );
      } catch (statusError) {
        console.error("[AutoMode] Failed to update feature status after error:", statusError);
      }

      sendToRenderer({
        type: "auto_mode_error",
        error: error.message,
        featureId: featureId,
      });
      throw error;
    } finally {
      // Clean up this feature's execution
      this.runningFeatures.delete(featureId);
    }
  }

  /**
   * New periodic loop - checks available slots and starts features up to max concurrency
   * This loop continues running even if there are no backlog items
   */
  runPeriodicLoop(projectPath, sendToRenderer) {
    console.log(
      `[AutoMode] Starting periodic loop with interval: ${this.checkIntervalMs}ms`
    );

    // Initial check immediately
    this.checkAndStartFeatures(projectPath, sendToRenderer);

    // Then check periodically
    this.autoLoopInterval = setInterval(() => {
      if (this.autoLoopRunning) {
        this.checkAndStartFeatures(projectPath, sendToRenderer);
      }
    }, this.checkIntervalMs);
  }

  /**
   * Check how many features are running and start new ones if under max concurrency
   */
  async checkAndStartFeatures(projectPath, sendToRenderer) {
    try {
      // Check how many are currently running
      const currentRunningCount = this.runningFeatures.size;

      console.log(
        `[AutoMode] Checking features - Running: ${currentRunningCount}/${this.maxConcurrency}`
      );

      // Calculate available slots
      const availableSlots = this.maxConcurrency - currentRunningCount;

      if (availableSlots <= 0) {
        console.log("[AutoMode] At max concurrency, waiting...");
        return;
      }

      // Load features from backlog
      const features = await featureLoader.loadFeatures(projectPath);
      const backlogFeatures = features.filter((f) => f.status === "backlog");

      if (backlogFeatures.length === 0) {
        console.log("[AutoMode] No backlog features available, waiting...");
        return;
      }

      // Grab up to availableSlots features from backlog
      const featuresToStart = backlogFeatures.slice(0, availableSlots);

      console.log(
        `[AutoMode] Starting ${featuresToStart.length} feature(s) from backlog`
      );

      // Start each feature (don't await - run in parallel like drag operations)
      for (const feature of featuresToStart) {
        this.startFeatureAsync(feature, projectPath, sendToRenderer);
      }
    } catch (error) {
      console.error("[AutoMode] Error checking/starting features:", error);
    }
  }

  /**
   * Start a feature asynchronously (similar to drag operation)
   * @param {Object} feature - The feature to start
   * @param {string} projectPath - Path to the project
   * @param {Function} sendToRenderer - Function to send events to renderer
   * @param {boolean} useWorktrees - Whether to use git worktree isolation (default: false)
   */
  async startFeatureAsync(feature, projectPath, sendToRenderer, useWorktrees = false) {
    const featureId = feature.id;

    // Skip if already running
    if (this.runningFeatures.has(featureId)) {
      console.log(`[AutoMode] Feature ${featureId} already running, skipping`);
      return;
    }

    try {
      console.log(
        `[AutoMode] Starting feature: ${feature.description.slice(0, 50)}... (worktrees: ${useWorktrees})`
      );

      // Register this feature as running
      const execution = this.createExecutionContext(featureId);
      execution.projectPath = projectPath;
      execution.sendToRenderer = sendToRenderer;
      this.runningFeatures.set(featureId, execution);

      // Setup worktree for isolated work (if enabled)
      const worktreeSetup = await this.setupWorktreeForFeature(feature, projectPath, sendToRenderer, useWorktrees);
      execution.worktreePath = worktreeSetup.workPath;
      execution.branchName = worktreeSetup.branchName;

      // Determine working path (worktree or main project)
      const workPath = worktreeSetup.workPath;

      // Update status to in_progress with timestamp
      await featureLoader.updateFeatureStatus(
        featureId,
        "in_progress",
        projectPath
      );

      sendToRenderer({
        type: "auto_mode_feature_start",
        featureId: feature.id,
        feature: { ...feature, worktreePath: worktreeSetup.workPath, branchName: worktreeSetup.branchName },
      });

      // Implement the feature (agent works in worktree)
      const result = await featureExecutor.implementFeature(
        feature,
        workPath, // Use worktree path instead of main project
        sendToRenderer,
        execution
      );

      // Update feature status based on result
      // For skipTests features, go to waiting_approval on success instead of verified
      // On failure, ALL features go to waiting_approval so user can review and decide next steps
      // This prevents infinite retry loops when the same issue keeps failing
      let newStatus;
      if (result.passes) {
        newStatus = feature.skipTests ? "waiting_approval" : "verified";
      } else {
        // On failure, go to waiting_approval for user review
        // Don't automatically move back to backlog to avoid infinite retry loops
        // (especially when hitting rate limits or persistent errors)
        newStatus = "waiting_approval";
      }
      await featureLoader.updateFeatureStatus(
        feature.id,
        newStatus,
        projectPath
      );

      // Keep context file for viewing output later (deleted only when card is removed)

      sendToRenderer({
        type: "auto_mode_feature_complete",
        featureId: feature.id,
        passes: result.passes,
        message: result.message,
      });
    } catch (error) {
      console.error(`[AutoMode] Error running feature ${featureId}:`, error);

      // Write error to context file
      try {
        await contextManager.writeToContextFile(
          projectPath,
          featureId,
          `\n\n❌ ERROR: ${error.message}\n\n${error.stack || ''}\n`
        );
      } catch (contextError) {
        console.error("[AutoMode] Failed to write error to context:", contextError);
      }

      // Update feature status to waiting_approval so user can review the error
      try {
        await featureLoader.updateFeatureStatus(
          featureId,
          "waiting_approval",
          projectPath,
          null, // no summary
          error.message // pass error message
        );
      } catch (statusError) {
        console.error("[AutoMode] Failed to update feature status after error:", statusError);
      }

      sendToRenderer({
        type: "auto_mode_error",
        error: error.message,
        featureId: featureId,
      });
    } finally {
      // Clean up this feature's execution
      this.runningFeatures.delete(featureId);
    }
  }

  /**
   * Analyze a new project - scans codebase and updates app_spec.txt
   * This is triggered when opening a project for the first time
   */
  async analyzeProject({ projectPath, sendToRenderer }) {
    console.log(`[AutoMode] Analyzing project at: ${projectPath}`);

    const analysisId = `project-analysis-${Date.now()}`;

    // Check if already analyzing this project
    if (this.runningFeatures.has(analysisId)) {
      throw new Error("Project analysis is already running");
    }

    // Register as running
    const execution = this.createExecutionContext(analysisId);
    execution.projectPath = projectPath;
    execution.sendToRenderer = sendToRenderer;
    this.runningFeatures.set(analysisId, execution);

    try {
      sendToRenderer({
        type: "auto_mode_feature_start",
        featureId: analysisId,
        feature: {
          id: analysisId,
          category: "Project Analysis",
          description: "Analyzing project structure and tech stack",
        },
      });

      // Perform the analysis
      const result = await projectAnalyzer.runProjectAnalysis(
        projectPath,
        analysisId,
        sendToRenderer,
        execution
      );

      sendToRenderer({
        type: "auto_mode_feature_complete",
        featureId: analysisId,
        passes: result.success,
        message: result.message,
      });

      return { success: true, message: result.message };
    } catch (error) {
      console.error("[AutoMode] Error analyzing project:", error);
      sendToRenderer({
        type: "auto_mode_error",
        error: error.message,
        featureId: analysisId,
      });
      throw error;
    } finally {
      this.runningFeatures.delete(analysisId);
    }
  }

  /**
   * Stop a specific feature by ID
   */
  async stopFeature({ featureId }) {
    if (!this.runningFeatures.has(featureId)) {
      return { success: false, error: `Feature ${featureId} is not running` };
    }

    console.log(`[AutoMode] Stopping feature: ${featureId}`);

    const execution = this.runningFeatures.get(featureId);
    if (execution && execution.abortController) {
      execution.abortController.abort();
    }

    // Clean up
    this.runningFeatures.delete(featureId);

    return { success: true };
  }

  /**
   * Follow-up on a feature with additional prompt
   * This continues work on a feature that's in waiting_approval status
   */
  async followUpFeature({
    projectPath,
    featureId,
    prompt,
    imagePaths,
    sendToRenderer,
  }) {
    // Check if this feature is already running
    if (this.runningFeatures.has(featureId)) {
      throw new Error(`Feature ${featureId} is already running`);
    }

    console.log(
      `[AutoMode] Follow-up on feature: ${featureId} with prompt: ${prompt}`
    );

    // Register this feature as running
    const execution = this.createExecutionContext(featureId);
    execution.projectPath = projectPath;
    execution.sendToRenderer = sendToRenderer;
    this.runningFeatures.set(featureId, execution);

    // Start the async work in the background (don't await)
    // This allows the API to return immediately so the modal can close
    this.runFollowUpWork({
      projectPath,
      featureId,
      prompt,
      imagePaths,
      sendToRenderer,
      execution,
    }).catch((error) => {
      console.error("[AutoMode] Follow-up work error:", error);
      this.runningFeatures.delete(featureId);
    });

    // Return immediately so the frontend can close the modal
    return { success: true };
  }

  /**
   * Internal method to run follow-up work asynchronously
   */
  async runFollowUpWork({
    projectPath,
    featureId,
    prompt,
    imagePaths,
    sendToRenderer,
    execution,
  }) {
    try {
      // Load features
      const features = await featureLoader.loadFeatures(projectPath);
      const feature = features.find((f) => f.id === featureId);

      if (!feature) {
        throw new Error(`Feature ${featureId} not found`);
      }

      console.log(`[AutoMode] Following up on feature: ${feature.description}`);

      // Update status to in_progress
      await featureLoader.updateFeatureStatus(
        featureId,
        "in_progress",
        projectPath
      );

      sendToRenderer({
        type: "auto_mode_feature_start",
        featureId: feature.id,
        feature: feature,
      });

      // Read existing context and append follow-up prompt
      const previousContext = await contextManager.readContextFile(
        projectPath,
        featureId
      );

      // Append follow-up prompt to context
      const followUpContext = `${previousContext}\n\n## Follow-up Instructions\n\n${prompt}`;
      await contextManager.writeToContextFile(
        projectPath,
        featureId,
        `\n\n## Follow-up Instructions\n\n${prompt}`
      );

      // Resume implementation with follow-up context and optional images
      const result = await featureExecutor.resumeFeatureWithContext(
        { ...feature, followUpPrompt: prompt, followUpImages: imagePaths },
        projectPath,
        sendToRenderer,
        followUpContext,
        execution
      );

      // For skipTests features, go to waiting_approval on success instead of verified
      // On failure, go to waiting_approval so user can review and decide next steps
      const newStatus = result.passes
        ? feature.skipTests
          ? "waiting_approval"
          : "verified"
        : "waiting_approval";

      await featureLoader.updateFeatureStatus(
        feature.id,
        newStatus,
        projectPath
      );

      // Keep context file for viewing output later (deleted only when card is removed)

      sendToRenderer({
        type: "auto_mode_feature_complete",
        featureId: feature.id,
        passes: result.passes,
        message: result.message,
      });
    } catch (error) {
      console.error("[AutoMode] Error in follow-up:", error);

      // Write error to context file
      try {
        await contextManager.writeToContextFile(
          projectPath,
          featureId,
          `\n\n❌ ERROR: ${error.message}\n\n${error.stack || ''}\n`
        );
      } catch (contextError) {
        console.error("[AutoMode] Failed to write error to context:", contextError);
      }

      // Update feature status to waiting_approval so user can review the error
      try {
        await featureLoader.updateFeatureStatus(
          featureId,
          "waiting_approval",
          projectPath,
          null, // no summary
          error.message // pass error message
        );
      } catch (statusError) {
        console.error("[AutoMode] Failed to update feature status after error:", statusError);
      }

      sendToRenderer({
        type: "auto_mode_error",
        error: error.message,
        featureId: featureId,
      });
    } finally {
      this.runningFeatures.delete(featureId);
    }
  }

  /**
   * Commit changes for a feature without doing additional work
   * This marks the feature as verified and commits the changes
   */
  async commitFeature({ projectPath, featureId, sendToRenderer }) {
    console.log(`[AutoMode] Committing feature: ${featureId}`);

    // Register briefly as running for the commit operation
    const execution = this.createExecutionContext(featureId);
    execution.projectPath = projectPath;
    execution.sendToRenderer = sendToRenderer;
    this.runningFeatures.set(featureId, execution);

    try {
      // Load feature to get description for commit message
      const features = await featureLoader.loadFeatures(projectPath);
      const feature = features.find((f) => f.id === featureId);

      if (!feature) {
        throw new Error(`Feature ${featureId} not found`);
      }

      sendToRenderer({
        type: "auto_mode_feature_start",
        featureId: feature.id,
        feature: { ...feature, description: "Committing changes..." },
      });

      sendToRenderer({
        type: "auto_mode_phase",
        featureId,
        phase: "action",
        message: "Committing changes to git...",
      });

      // Run git commit via the agent
      await featureExecutor.commitChangesOnly(
        feature,
        projectPath,
        sendToRenderer,
        execution
      );

      // Update status to verified
      await featureLoader.updateFeatureStatus(
        featureId,
        "verified",
        projectPath
      );

      // Keep context file for viewing output later (deleted only when card is removed)

      sendToRenderer({
        type: "auto_mode_feature_complete",
        featureId: feature.id,
        passes: true,
        message: "Changes committed successfully",
      });

      return { success: true };
    } catch (error) {
      console.error("[AutoMode] Error committing feature:", error);
      sendToRenderer({
        type: "auto_mode_error",
        error: error.message,
        featureId: featureId,
      });
      throw error;
    } finally {
      this.runningFeatures.delete(featureId);
    }
  }

  /**
   * Sleep helper
   */
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Revert feature changes by removing the worktree
   * This effectively discards all changes made by the agent
   */
  async revertFeature({ projectPath, featureId, sendToRenderer }) {
    console.log(`[AutoMode] Reverting feature: ${featureId}`);

    try {
      // Stop the feature if it's running
      if (this.runningFeatures.has(featureId)) {
        await this.stopFeature({ featureId });
      }

      // Remove the worktree and delete the branch
      const result = await worktreeManager.removeWorktree(projectPath, featureId, true);

      if (!result.success) {
        throw new Error(result.error || "Failed to remove worktree");
      }

      // Clear worktree info from feature
      await featureLoader.updateFeatureWorktree(featureId, projectPath, null, null);

      // Update feature status back to backlog
      await featureLoader.updateFeatureStatus(featureId, "backlog", projectPath);

      // Delete context file
      await contextManager.deleteContextFile(projectPath, featureId);

      if (sendToRenderer) {
        sendToRenderer({
          type: "auto_mode_feature_complete",
          featureId: featureId,
          passes: false,
          message: "Feature reverted - all changes discarded",
        });
      }

      console.log(`[AutoMode] Feature ${featureId} reverted successfully`);
      return { success: true, removedPath: result.removedPath };
    } catch (error) {
      console.error("[AutoMode] Error reverting feature:", error);
      if (sendToRenderer) {
        sendToRenderer({
          type: "auto_mode_error",
          error: error.message,
          featureId: featureId,
        });
      }
      return { success: false, error: error.message };
    }
  }

  /**
   * Merge feature worktree changes back to main branch
   */
  async mergeFeature({ projectPath, featureId, options = {}, sendToRenderer }) {
    console.log(`[AutoMode] Merging feature: ${featureId}`);

    try {
      // Load feature to get worktree info
      const features = await featureLoader.loadFeatures(projectPath);
      const feature = features.find((f) => f.id === featureId);

      if (!feature) {
        throw new Error(`Feature ${featureId} not found`);
      }

      if (sendToRenderer) {
        sendToRenderer({
          type: "auto_mode_progress",
          featureId: featureId,
          content: "Merging feature branch into main...\n",
        });
      }

      // Merge the worktree
      const result = await worktreeManager.mergeWorktree(projectPath, featureId, {
        ...options,
        cleanup: true, // Remove worktree after successful merge
      });

      if (!result.success) {
        throw new Error(result.error || "Failed to merge worktree");
      }

      // Clear worktree info from feature
      await featureLoader.updateFeatureWorktree(featureId, projectPath, null, null);

      // Update feature status to verified
      await featureLoader.updateFeatureStatus(featureId, "verified", projectPath);

      if (sendToRenderer) {
        sendToRenderer({
          type: "auto_mode_feature_complete",
          featureId: featureId,
          passes: true,
          message: `Feature merged into ${result.intoBranch}`,
        });
      }

      console.log(`[AutoMode] Feature ${featureId} merged successfully`);
      return { success: true, mergedBranch: result.mergedBranch };
    } catch (error) {
      console.error("[AutoMode] Error merging feature:", error);
      if (sendToRenderer) {
        sendToRenderer({
          type: "auto_mode_error",
          error: error.message,
          featureId: featureId,
        });
      }
      return { success: false, error: error.message };
    }
  }

  /**
   * Get worktree info for a feature
   */
  async getWorktreeInfo({ projectPath, featureId }) {
    return await worktreeManager.getWorktreeInfo(projectPath, featureId);
  }

  /**
   * Get worktree status (changed files, commits, etc.)
   */
  async getWorktreeStatus({ projectPath, featureId }) {
    const worktreeInfo = await worktreeManager.getWorktreeInfo(projectPath, featureId);
    if (!worktreeInfo.success) {
      return { success: false, error: "Worktree not found" };
    }
    return await worktreeManager.getWorktreeStatus(worktreeInfo.worktreePath);
  }

  /**
   * List all feature worktrees
   */
  async listWorktrees({ projectPath }) {
    const worktrees = await worktreeManager.getAllFeatureWorktrees(projectPath);
    return { success: true, worktrees };
  }

  /**
   * Get file diffs for a feature worktree
   */
  async getFileDiffs({ projectPath, featureId }) {
    const worktreeInfo = await worktreeManager.getWorktreeInfo(projectPath, featureId);
    if (!worktreeInfo.success) {
      return { success: false, error: "Worktree not found" };
    }
    return await worktreeManager.getFileDiffs(worktreeInfo.worktreePath);
  }

  /**
   * Get diff for a specific file in a feature worktree
   */
  async getFileDiff({ projectPath, featureId, filePath }) {
    const worktreeInfo = await worktreeManager.getWorktreeInfo(projectPath, featureId);
    if (!worktreeInfo.success) {
      return { success: false, error: "Worktree not found" };
    }
    return await worktreeManager.getFileDiff(worktreeInfo.worktreePath, filePath);
  }
}

// Export singleton instance
module.exports = new AutoModeService();
