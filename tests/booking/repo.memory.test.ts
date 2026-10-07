import { repoContract } from "./repo.contract";
import { InMemoryBookingRepo } from "@/server/booking-repo";
import { designer } from "./helpers";

repoContract("in-memory", async () => ({
  repo: new InMemoryBookingRepo([designer("A", "A"), designer("B", "B"), designer("Z", "Z", { active: false })]),
  designerIds: ["A", "B"], inactiveDesignerId: "Z", enquiryIds: ["e1", "e2", "e3"],
}));
