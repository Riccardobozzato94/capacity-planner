import type { Assignment, CapacityResult, Demand, Member } from "./types.ts";

const PRIORITY_ORDER: Record<Demand["priority"], number> = {
  high: 0,
  medium: 1,
  low: 2,
};

export function planCapacity(
  members: Member[],
  demands: Demand[],
  sprint: string,
  generatedAt: string
): CapacityResult {
  const remaining = new Map<string, number>();
  const assignedHours = new Map<string, number>();
  for (const member of members) {
    remaining.set(member.id, member.availableHours);
    assignedHours.set(member.id, 0);
  }

  const sortedDemands = [...demands].sort(
    (a, b) =>
      PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] ||
      b.effortHours - a.effortHours
  );

  const assignments: Assignment[] = [];
  const unassigned: string[] = [];

  for (const demand of sortedDemands) {
    let best: Member | null = null;
    let bestRemaining = -1;
    for (const member of members) {
      if (!member.skills.includes(demand.skill)) continue;
      const rem = remaining.get(member.id)!;
      if (rem > bestRemaining) {
        best = member;
        bestRemaining = rem;
      }
    }

    if (best && bestRemaining >= demand.effortHours) {
      remaining.set(best.id, bestRemaining - demand.effortHours);
      assignedHours.set(best.id, assignedHours.get(best.id)! + demand.effortHours);
      assignments.push({ demandId: demand.id, memberId: best.id, reason: "" });
    } else {
      assignments.push({
        demandId: demand.id,
        memberId: null,
        reason: `Nessuna disponibilità per skill ${demand.skill}: servono ${demand.effortHours} h`,
      });
      unassigned.push(demand.id);
    }
  }

  const memberResults = members.map((member) => {
    const assigned = assignedHours.get(member.id)!;
    const utilizationPct =
      member.availableHours > 0 ? (assigned / member.availableHours) * 100 : 0;
    return {
      member,
      assignedHours: assigned,
      utilizationPct,
      overloaded: utilizationPct > 85,
    };
  });

  const totals = {
    demandHours: demands.reduce((sum, d) => sum + d.effortHours, 0),
    availableHours: members.reduce((sum, m) => sum + m.availableHours, 0),
    overloadedMembers: memberResults.filter((r) => r.overloaded).length,
  };

  return { sprint, members: memberResults, assignments, unassigned, totals, generatedAt };
}
