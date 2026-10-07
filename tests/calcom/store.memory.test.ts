import { calStoreContract } from "./store.contract";
import { InMemoryCalBookingStore } from "@/server/calcom-store";
calStoreContract("in-memory", async () => new InMemoryCalBookingStore());
