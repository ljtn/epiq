Basic structure of our sync flow:

1. Is this a Git repository?
   no -> fail: "Not a Git repository"
   yes -> proceed

2. Does local HEAD exist?
   no -> initial sync path - if remote has history: fetch/pull remote branch - else: create/push initial local history if Epiq has changes
   yes -> proceed

3. Is HEAD detached?
   yes -> fail: "Cannot sync from detached HEAD. Checkout a branch first."
   no -> proceed

4. Does remote branch have commits?
   yes -> pull --rebase remote branch
   no -> push local branch
