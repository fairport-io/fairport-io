# TRAINING

> [!IMPORTANT]
> Welcome to the team! 👋 In order to contribute to this repository, you must complete this quick training module. This ensures your local Git environment is set up correctly and you are familiar with our Pull Request (PR) workflow.

## Steps

If you're alerady acquainted with git and pull-requests, you can skip to the [Speed Run (Advanced)](#speed-run-advanced) section.

If you're just getting started with git follow this directions:

0. [Prerequisites](#0-prerequisites)
1. [Create a new branch](#1-create-a-new-branch)
2. [Add your github username to `.GRADUATES.md`](#2-add-your-username-to-graduatesmd)
3. [Submit a pull request](#3-submit-a-pull-request)

---

## 0. Prerequisites

Before starting, make sure your Git identity is configured, and clone the repository to your local machine.

Open your terminal and run:

```bash
# Set up your Git identity (if you haven't already on this machine)
git config --global user.name "Your Actual Name"
git config --global user.email "your.email@company.com"

# Clone the repository and navigate into it
git clone git@github.com:fairport-io/fairport-io.git
cd fairport-io
```

---

## 1. Create a New Branch

To avoid typing your username over and over, we will set it as an environment variable in your terminal first. 

> [!WARNING]
> In the first command below, put your actual GitHub username inside the quotes!

```bash
export GH_USER="replace_with_your_username"

git checkout main
git pull origin main
git checkout -b ${GH_USER}/training
```

---

## 2. Add Your Username to `.GRADUATES.md`

Instead of opening a text editor, we can use the terminal to safely append your username to the very bottom of the `.GRADUATES.md` file. 

```bash
# Safely append your name to the bottom of the list
echo "- ${GH_USER}" >> .GRADUATES.md

# Stage and commit the change in one step
git commit -am "Training: add ${GH_USER} to .GRADUATES.md"
```

---

## 3. Submit a Pull Request

Push your new branch up to GitHub and open a Pull Request.

```bash
# Push your local branch to the remote repository
git push -u origin ${GH_USER}/training

# Automatically open the Pull Request page in your web browser
open https://github.com/fairport-io/fairport-io/pull/new/${GH_USER}/training
```

> [!NOTE]
> *If the `open` command doesn't work on your operating system, just copy the URL above and paste it into your browser!*
> 
> You did it! 🎉 A maintainer will review and merge your PR. Once merged, you are officially a graduate and ready to contribute to the codebase.

---

## Speed Run (Advanced)

Already know what you're doing? Just fill in your username on the first line and copy/paste this entire block into your terminal:

```bash
export GH_USER="" # Replace with your username inside the quotes
git clone git@github.com:fairport-io/fairport-io.git
cd fairport-io
git checkout -b ${GH_USER}/training
echo "- ${GH_USER}" >> .GRADUATES.md
git commit -am "Training: add ${GH_USER} to .GRADUATES.md"
git push -u origin ${GH_USER}/training
open https://github.com/fairport-io/fairport-io/pull/new/${GH_USER}/training
```
