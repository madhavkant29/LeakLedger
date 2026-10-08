export type DemoUser = { id: string; name: string; role: string; description: string; initials: string };
export const USERS: DemoUser[] = [
  { id: "user-1", name: "Aarav Mehta", role: "Facility Manager", description: "Owns site water accountability and incident response.", initials: "AM" },
  { id: "user-2", name: "Neha Sharma", role: "Maintenance Engineer", description: "Investigates boundaries, records repairs, verifies outcomes.", initials: "NS" },
  { id: "user-3", name: "Rohan Kapoor", role: "Operations Manager", description: "Reviews operating risk, evidence quality and audit history.", initials: "RK" },
];

export function getUser(): DemoUser {
  if (typeof window === "undefined") return USERS[0];
  const id = localStorage.getItem("leakledger-user") || USERS[0].id;
  return USERS.find(u => u.id === id) || USERS[0];
}
