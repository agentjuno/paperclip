import { describe, expect, it } from "vitest";
import {
  buildOnboardingIssuePayload,
  buildOnboardingProjectPayload,
  buildOnboardingTaskDescription,
  DEFAULT_TASK_DESCRIPTION,
  selectDefaultCompanyGoalId,
} from "./onboarding-launch";

describe("selectDefaultCompanyGoalId", () => {
  it("prefers the earliest active root company goal", () => {
    expect(
      selectDefaultCompanyGoalId([
        {
          id: "team-goal",
          companyId: "company-1",
          title: "Nested",
          description: null,
          level: "team",
          status: "active",
          parentId: null,
          ownerAgentId: null,
          createdAt: new Date("2026-03-04T00:00:00Z"),
          updatedAt: new Date("2026-03-04T00:00:00Z"),
        },
        {
          id: "goal-2",
          companyId: "company-1",
          title: "Later active root",
          description: null,
          level: "company",
          status: "active",
          parentId: null,
          ownerAgentId: null,
          createdAt: new Date("2026-03-03T00:00:00Z"),
          updatedAt: new Date("2026-03-03T00:00:00Z"),
        },
        {
          id: "goal-1",
          companyId: "company-1",
          title: "Earliest active root",
          description: null,
          level: "company",
          status: "active",
          parentId: null,
          ownerAgentId: null,
          createdAt: new Date("2026-03-02T00:00:00Z"),
          updatedAt: new Date("2026-03-02T00:00:00Z"),
        },
      ]),
    ).toBe("goal-1");
  });

  it("falls back to the earliest root company goal when none are active", () => {
    expect(
      selectDefaultCompanyGoalId([
        {
          id: "goal-2",
          companyId: "company-1",
          title: "Cancelled root",
          description: null,
          level: "company",
          status: "cancelled",
          parentId: null,
          ownerAgentId: null,
          createdAt: new Date("2026-03-03T00:00:00Z"),
          updatedAt: new Date("2026-03-03T00:00:00Z"),
        },
        {
          id: "goal-1",
          companyId: "company-1",
          title: "Earliest root",
          description: null,
          level: "company",
          status: "planned",
          parentId: null,
          ownerAgentId: null,
          createdAt: new Date("2026-03-02T00:00:00Z"),
          updatedAt: new Date("2026-03-02T00:00:00Z"),
        },
      ]),
    ).toBe("goal-1");
  });
});

describe("onboarding launch payloads", () => {
  it("links the onboarding project and first issue to the selected goal", () => {
    expect(buildOnboardingProjectPayload("goal-1")).toEqual({
      name: "Onboarding",
      status: "in_progress",
      goalIds: ["goal-1"],
    });

    expect(
      buildOnboardingIssuePayload({
        title: "  Hire your first engineer  ",
        description: "  Kick off the hiring plan  ",
        assigneeAgentId: "agent-1",
        projectId: "project-1",
        goalId: "goal-1",
      }),
    ).toEqual({
      title: "Hire your first engineer",
      description: "Kick off the hiring plan",
      assigneeAgentId: "agent-1",
      projectId: "project-1",
      goalId: "goal-1",
      status: "todo",
    });
  });

  it("omits goal links when no default company goal exists", () => {
    expect(buildOnboardingProjectPayload(null)).toEqual({
      name: "Onboarding",
      status: "in_progress",
    });

    expect(
      buildOnboardingIssuePayload({
        title: "Task",
        description: "",
        assigneeAgentId: "agent-1",
        projectId: "project-1",
        goalId: null,
      }),
    ).toEqual({
      title: "Task",
      assigneeAgentId: "agent-1",
      projectId: "project-1",
      status: "todo",
    });
  });
});

describe("buildOnboardingTaskDescription", () => {
  it("returns default description when buildOnExisting is false", () => {
    expect(
      buildOnboardingTaskDescription({
        buildOnExisting: false,
        existingBusinessUrl: "https://example.com",
      }),
    ).toBe(DEFAULT_TASK_DESCRIPTION);
  });

  it("returns default description when buildOnExisting is true but URL is empty", () => {
    expect(
      buildOnboardingTaskDescription({
        buildOnExisting: true,
        existingBusinessUrl: "",
      }),
    ).toBe(DEFAULT_TASK_DESCRIPTION);
  });

  it("returns modified description with URL when buildOnExisting is true and URL is non-empty", () => {
    const result = buildOnboardingTaskDescription({
      buildOnExisting: true,
      existingBusinessUrl: "https://example.com",
    });
    expect(result).toContain("building on top of an existing business");
    expect(result).toContain("Existing business: https://example.com");
    expect(result).toContain("research the existing business thoroughly");
    expect(result).not.toBe(DEFAULT_TASK_DESCRIPTION);
  });

  it("trims the URL", () => {
    const result = buildOnboardingTaskDescription({
      buildOnExisting: true,
      existingBusinessUrl: "  https://example.com  ",
    });
    expect(result).toContain("Existing business: https://example.com");
    expect(result).not.toContain("Existing business:   https://example.com");
  });
});
