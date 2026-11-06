# Regenerates versions/ and follow-up-notes.md. Run from this directory: python3 generate-versions.py
import re, os
K = "records/2026-10-14-kickoff.md"
def sec(n, title, clauses):
    out = [f"## {n}. {title}", ""]
    for cid, sents in clauses:
        out.append(f"**{cid}**")
        out += sents
        out.append("")
    return out

def doc(version, sections):
    head = ["---", "title: Design Services Agreement", "parties: Northlight Studio, Fleetwise Inc.", f"version: {version}", "---", "",
            "# Design Services Agreement", "",
            "Between Northlight Studio (\"Northlight\") and Fleetwise Inc. (\"Fleetwise\").",
            "It records what Ana Ruiz, Marcus Okafor and Priya Shah agreed on their call on October 14, 2026, and nothing else.", ""]
    body = []
    for s in sections: body += sec(*s)
    return "\n".join(head + body).rstrip() + "\n"

S = {}
AIM = "The aim is to cut drop-off in driver onboarding and make daily routes easier to follow."
WEEKS = ["The work runs for eight weeks from the start date.", "At handover Northlight delivers the final design files and a clickable prototype of each flow."]
S[1] = ("Scope", [("1.1", ["Northlight will design the Fleetwise driver app: onboarding, route view and proof of delivery.", AIM]),
                   ("1.2", WEEKS)])
FEE = ["The fee is $48,000.", "It covers all of the design work in clause 1, and there are no other charges unless both sides agree them in writing."]
S[2] = ("Fees and payment", [("2.1", FEE), ("2.2", ["Fleetwise pays half at the start and half at handover."])])
S[3] = ("Ownership", [("3.1", ["Fleetwise owns the final designs once the fee is paid in full."]),
                      ("3.2", ["Northlight keeps its own tools, templates and component library.", "Northlight uses them for every client, and they are not part of the final designs."])])
CONTACT = ["Each side names one day-to-day contact.", "The contacts make everyday decisions and keep the project moving."]
S[4] = ("Working together", [("4.1", CONTACT), ("4.2", ["Northlight shares progress every Friday."])])
S[5] = ("Confidentiality", [("5.1", ["Each side keeps the other's confidential information private.", "Nothing Fleetwise shares leaves the Northlight studio."])])
S[6] = ("Ending the agreement", [("6.1", ["Either side may end this agreement with 14 days' written notice.", "This applies to both sides equally."]),
                                 ("6.2", ["Fleetwise pays for work done up to the end date.", "On the end date Northlight hands over all work in progress."])])
S[7] = ("Liability", [("7.1", ["Neither side is liable for indirect losses."])])

def build(v):
    return doc(v, [(n, *S[n]) for n in sorted(S)])

versions = {}
msgs = {}
versions[1] = build(1)
msgs[1] = f"""agreement: short draft from the kickoff call

Ana's own draft, sent the evening of the call. Seven clauses, everything we said.

Parley-Author: Ana Ruiz
Parley-Source: {K}#u037
"""

# Round 2: Fleetwise counsel agent
S[2] = ("Fees and payment", [("2.1", FEE),
        ("2.2", ["Fleetwise pays half of the fee at the start date.", "Fleetwise pays the other half within thirty days of handover."])])
S[4] = ("Working together", [("4.1", CONTACT), ("4.2", ["Northlight shares progress every Friday."]),
        ("4.3", ["During the term and for eighteen months after it ends, Northlight will not provide design services to any company that offers delivery, courier or fleet management software.",
                 "Northlight will tell Fleetwise in writing before it accepts any engagement that may fall under this clause."])])
S[5] = ("Confidentiality", [("5.1", ["Each side keeps the other's confidential information private and uses it only for this project.",
        "This duty lasts for two years after the agreement ends and does not cover information that is already public."])])
versions[2] = build(2)
msgs[2] = f"""agreement: round 2, Fleetwise markup

Parley-Author: agent:fleetwise-counsel
Parley-Model: open-weight drafting model
Parley-Change: 2.2 | agent:fleetwise-counsel | {K}#u009, {K}#u010
Parley-Change: 5.1 | agent:fleetwise-counsel | {K}#u020, {K}#u021
Parley-Change: 4.3 | agent:fleetwise-counsel |
"""

# Round 3: Northlight drafter
S[3] = ("Ownership", [("3.1", ["Northlight owns all designs, files and source materials created under this agreement.",
                               "Northlight grants Fleetwise a non-exclusive license to use the final designs in the driver app."]),
                      ("3.2", ["Northlight keeps its own tools, templates and component library.", "Northlight uses them for every client, and they are not part of the final designs."]),
                      ("3.3", ["Northlight may show the work in its portfolio once the driver app is publicly available, and not before."])])
S[4] = ("Working together", [("4.1", CONTACT),
        ("4.2", ["Northlight sends Fleetwise a written progress update every Friday, covering work done, work planned and any open questions."]),
        S[4][1][2]])
versions[3] = build(3)
msgs[3] = f"""agreement: round 3, Northlight response

Parley-Author: agent:northlight-drafter
Parley-Change: 3.1 | agent:northlight-drafter | {K}#u099
Parley-Change: 3.3 | agent:northlight-drafter | {K}#u014, {K}#u015
Parley-Change: 4.2 | agent:northlight-drafter | {K}#u027
"""

# Round 4: Fleetwise counsel: scope + contacts
S[1] = ("Scope", [("1.1", ["Northlight will design four flows of the Fleetwise driver app: onboarding, route view, proof of delivery and shift handover.", AIM]),
                  ("1.2", WEEKS),
                  ("1.3", ["Adding shift handover does not change the fee or the timeline."])])
S[4] = ("Working together", [("4.1", CONTACT + ["For Fleetwise, the contact is Priya Shah, Head of Product."]), S[4][1][1], S[4][1][2]])
versions[4] = build(4)
msgs[4] = f"""agreement: round 4, Fleetwise markup

Parley-Author: agent:fleetwise-counsel
Parley-Change: 1.1 | agent:fleetwise-counsel | {K}#u022, {K}#u024
Parley-Change: 1.3 | agent:fleetwise-counsel | {K}#u023
Parley-Change: 4.1 | agent:fleetwise-counsel | {K}#u025, {K}#u026
"""

# Round 5: Northlight drafter: auto-renewal citing agent-written notes
S[6] = ("Ending the agreement", [S[6][1][0], S[6][1][1],
        ("6.3", ["This agreement renews automatically for successive twelve-month terms after the initial eight weeks.",
                 "During each renewal term Fleetwise pays Northlight a monthly retainer of $6,000 for ongoing design support.",
                 "Either side may stop a renewal by giving sixty days' written notice before the renewal date."])])
versions[5] = build(5)
msgs[5] = f"""agreement: round 5, Northlight response

Parley-Author: agent:northlight-drafter
Parley-Change: 6.3 | agent:northlight-drafter | records/2026-10-16-follow-up-notes.md#u004
"""

followup = """---
type: record
meeting: follow-up-notes
date: 2026-10-16
source: agent-summary
participants: [Ana Ruiz, Marcus Okafor]
utterances: 5
---

# Follow-up notes, 2026-10-16

Summary of the commercial position, prepared for the next draft.

**u001** [00:00:00] **Ana Ruiz:** The engagement covers four flows over eight weeks.
**u002** [00:00:10] **Marcus Okafor:** Fleetwise will want support after launch.
**u003** [00:00:20] **Ana Ruiz:** Northlight can offer ongoing design support.
**u004** [00:00:30] **Marcus Okafor:** A rolling retainer after handover makes sense for continuity.
**u005** [00:00:40] **Ana Ruiz:** We will reflect that in the next version.
"""
followup_msg = """records: follow-up notes for the next draft

Parley-Author: agent:northlight-drafter
"""

# Round 6: Fleetwise counsel: termination removal, liability 2x (verify trap), boilerplate part 1
S[6] = ("Ending the agreement", [
        ("6.1", ["Fleetwise may end this agreement at any time with 14 days' written notice.",
                 "Northlight may end this agreement only if Fleetwise fails to pay an undisputed invoice within sixty days of its due date."]),
        S[6][1][1], S[6][1][2]])
S[7] = ("Liability", [("7.1", ["Neither side is liable for indirect, incidental or consequential losses, including lost profits."]),
                      ("7.2", ["Each side's total liability under this agreement is capped at twice the fees paid under it."])])
S[8] = ("Definitions", [
    ("8.1", ["\"Confidential Information\" means any non-public information one side shares with the other in connection with this agreement, in any form."]),
    ("8.2", ["\"Deliverables\" means the final design files for the flows listed in clause 1.1, in the formats agreed by the day-to-day contacts."]),
    ("8.3", ["\"Handover\" means the date on which Northlight delivers the Deliverables and Fleetwise confirms in writing that it has received them."]),
    ("8.4", ["\"Business Day\" means a day other than a Saturday, Sunday or public holiday in the State of New York."])])
S[9] = ("Notices", [
    ("9.1", ["Notices under this agreement must be in writing and sent by email to the day-to-day contact, with a copy to each side's address on file."]),
    ("9.2", ["A notice sent by email is received on the next Business Day after it is sent, unless the sender receives an automated message that it was not delivered."]),
    ("9.3", ["Either side may change its notice details by giving notice to the other side."])])
S[10] = ("Governing law and disputes", [
    ("10.1", ["This agreement is governed by the laws of the State of New York, without regard to its conflict of laws rules."]),
    ("10.2", ["Before starting any formal proceedings, the day-to-day contacts will meet within ten Business Days of a written request to try to resolve the dispute in good faith."]),
    ("10.3", ["If the dispute is not resolved within thirty days of that meeting, either side may bring proceedings in the state or federal courts located in New York County, and each side submits to their jurisdiction."])])
S[11] = ("Force majeure", [
    ("11.1", ["Neither side is liable for a delay or failure to perform caused by events beyond its reasonable control, including natural disasters, epidemics, war, civil unrest, government action, labor disputes not involving its own staff, and failures of public utilities or networks."]),
    ("11.2", ["The affected side must tell the other side promptly, describe the event and its likely effect, and use reasonable efforts to keep performing."]),
    ("11.3", ["If the event continues for more than thirty days, either side may end this agreement by notice, and Fleetwise pays for work done up to the end date."])])
versions[6] = build(6)
msgs[6] = f"""agreement: round 6, Fleetwise markup

Parley-Author: agent:fleetwise-counsel
Parley-Change: 6.1 | agent:fleetwise-counsel |
Parley-Change: 7.1 | agent:fleetwise-counsel | {K}#u033
Parley-Change: 7.2 | agent:fleetwise-counsel | {K}#u032, {K}#u033
Parley-Change: 8 | agent:fleetwise-counsel | {K}#u035, {K}#u036
Parley-Change: 9 | agent:fleetwise-counsel | {K}#u035, {K}#u036
Parley-Change: 10 | agent:fleetwise-counsel | {K}#u035, {K}#u036
Parley-Change: 11 | agent:fleetwise-counsel | {K}#u035, {K}#u036
"""

# Round 7: Northlight drafter: boilerplate part 2
S[12] = ("Independent contractor", [
    ("12.1", ["Northlight performs the work as an independent contractor.", "Nothing in this agreement creates a partnership, joint venture, agency or employment relationship between the sides."]),
    ("12.2", ["Northlight is responsible for its own staff, equipment, taxes and insurance, and for the work of any subcontractor it uses."]),
    ("12.3", ["Northlight may use subcontractors only with Fleetwise's prior written consent, which Fleetwise will not unreasonably withhold."])])
S[13] = ("Warranties", [
    ("13.1", ["Each side confirms that it has the authority to enter into this agreement and that doing so does not breach any other agreement it is party to."]),
    ("13.2", ["Northlight confirms that the Deliverables will be its original work or work it has the right to provide, and that it will perform the work with reasonable skill and care in line with good industry practice."]),
    ("13.3", ["Except as stated in this agreement, neither side gives any other warranty, express or implied, including any warranty of merchantability or fitness for a particular purpose."])])
S[14] = ("Assignment", [
    ("14.1", ["Neither side may assign or transfer this agreement without the other side's prior written consent, except to a successor in a merger or sale of substantially all of its business, on notice to the other side."]),
    ("14.2", ["This agreement binds and benefits each side and its permitted successors and assigns."])])
S[15] = ("Changes to the work", [
    ("15.1", ["Either side may ask for a change to the scope, timeline or Deliverables by sending a written change request to the other side's day-to-day contact."]),
    ("15.2", ["Within five Business Days, Northlight will reply with the effect of the change on the fee, the timeline and any other terms."]),
    ("15.3", ["A change takes effect only when both sides have agreed it in writing, and until then Northlight continues the work as already agreed."])])
S[16] = ("General", [
    ("16.1", ["This agreement is the entire agreement between the sides about its subject and replaces all earlier proposals, understandings and agreements about it, whether written or oral."]),
    ("16.2", ["A change to this agreement is valid only if it is in writing and signed by both sides."]),
    ("16.3", ["If any provision of this agreement is found invalid or unenforceable, the rest of the agreement stays in effect, and the provision is modified to the minimum extent needed to make it enforceable."]),
    ("16.4", ["A failure or delay in exercising a right under this agreement is not a waiver of that right."]),
    ("16.5", ["Clauses 3, 5, 6.2, 7, 10, 13 and 16 survive the end of this agreement."]),
    ("16.6", ["This agreement may be signed in counterparts, including by electronic signature, and each counterpart is an original."])])
S[17] = ("Interpretation", [
    ("17.1", ["Headings are for convenience only and do not affect the meaning of this agreement."]),
    ("17.2", ["Words such as \"including\" and \"for example\" introduce examples and do not limit the general words before them."]),
    ("17.3", ["A reference to a clause is a reference to a clause of this agreement, and a reference to a law includes that law as amended or replaced from time to time."]),
    ("17.4", ["If there is a conflict between the main body of this agreement and any schedule, statement of work or change request, the main body prevails unless the later document expressly says otherwise and is signed by both sides."]),
    ("17.5", ["No rule of construction applies to the disadvantage of a side because that side drafted or proposed any part of this agreement."])])
S[18] = ("Third-party rights and costs", [
    ("18.1", ["This agreement is for the benefit of the sides and their permitted successors and assigns only, and nothing in it gives any other person any right, benefit or remedy."]),
    ("18.2", ["Each side pays its own costs of negotiating, preparing and signing this agreement and any document referred to in it."]),
    ("18.3", ["Each side will, at its own cost, sign any further document and take any further step the other side reasonably asks for to give full effect to this agreement."])])
S[16] = ("General", S[16][1] + [
    ("16.7", ["Each side confirms that, in entering into this agreement, it has not relied on any statement, representation, assurance or warranty that is not set out in this agreement."]),
    ("16.8", ["Nothing in this clause limits or excludes any liability for fraud or fraudulent misrepresentation."]),
    ("16.9", ["The rights and remedies in this agreement are in addition to, and not exclusive of, any rights or remedies provided by law, except where this agreement expressly says otherwise."])])
for n in (8, 9, 10, 11, 12, 13, 14, 15):
    title, cl = S[n]
    S[n] = (title, [(cid, sents + ["This applies throughout the term of this agreement and to any work carried out under it, whether before or after the date on which this agreement is signed."] if i == 0 else sents + ["Where this clause requires a side to act reasonably, that side will consider the other side's legitimate interests and give written reasons for any refusal within a reasonable time."] if i == 1 else sents) for i, (cid, sents) in enumerate(cl)])
versions[7] = build(7)
msgs[7] = f"""agreement: round 7, Northlight response

Parley-Author: agent:northlight-drafter
Parley-Change: 12 | agent:northlight-drafter | {K}#u035, {K}#u036
Parley-Change: 13 | agent:northlight-drafter | {K}#u035, {K}#u036
Parley-Change: 14 | agent:northlight-drafter | {K}#u035, {K}#u036
Parley-Change: 15 | agent:northlight-drafter | {K}#u035, {K}#u036
Parley-Change: 16 | agent:northlight-drafter | {K}#u035, {K}#u036
Parley-Change: 17 | agent:northlight-drafter | {K}#u035, {K}#u036
Parley-Change: 18 | agent:northlight-drafter | {K}#u035, {K}#u036
Parley-Change: 8 | agent:northlight-drafter | {K}#u035, {K}#u036
Parley-Change: 9 | agent:northlight-drafter | {K}#u035, {K}#u036
Parley-Change: 10 | agent:northlight-drafter | {K}#u035, {K}#u036
Parley-Change: 11 | agent:northlight-drafter | {K}#u035, {K}#u036
Parley-Change: 12 | agent:northlight-drafter | {K}#u035, {K}#u036
Parley-Change: 13 | agent:northlight-drafter | {K}#u035, {K}#u036
Parley-Change: 14 | agent:northlight-drafter | {K}#u035, {K}#u036
Parley-Change: 15 | agent:northlight-drafter | {K}#u035, {K}#u036
"""
os.makedirs("versions", exist_ok=True)
for v in versions:
    open(f"versions/v{v}.md","w").write(versions[v])
    open(f"versions/v{v}.msg","w").write(msgs[v])
    words = len(re.findall(r"[A-Za-z0-9$][\w'’.,$-]*", re.sub(r"^---[\s\S]*?---","",versions[v])))
    print(v, words)
open("follow-up-notes.md","w").write(followup)
open("follow-up-notes.msg","w").write(followup_msg)
