export type Member = {
  id: string;
  name: string;
  role: string;
  skills: string[];
  availableHours: number;
};

export type Demand = {
  id: string;
  title: string;
  skill: string;
  effortHours: number;
  priority: "high" | "medium" | "low";
};

export type Assignment = {
  demandId: string;
  memberId: string | null;
  reason: string;
};

export type CapacityResult = {
  sprint: string;
  members: Array<{
    member: Member;
    assignedHours: number;
    utilizationPct: number;
    overloaded: boolean;
  }>;
  assignments: Assignment[];
  unassigned: string[];
  totals: {
    demandHours: number;
    availableHours: number;
    overloadedMembers: number;
  };
  generatedAt: string;
};
