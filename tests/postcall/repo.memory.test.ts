import { postCallRepoContract } from "./repo.contract";
import { InMemoryPostCallRepo } from "@/server/postcall-repo";

postCallRepoContract("in-memory", async () => new InMemoryPostCallRepo("pepper-0123456789ab"));
