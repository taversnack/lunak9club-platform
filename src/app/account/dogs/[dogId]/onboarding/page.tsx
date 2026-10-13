import type { Metadata } from 'next';
import Link from 'next/link';
import s from '@/ui/ui.module.css';
import { Card, Stack } from '@/ui/components';
import { ActionForm, Checkbox, RadioGroup, SubmitButton, TextArea, TextField } from '@/ui/form';
import { CONSENT_GROUPS, consentsAsked } from '@/domain/compliance/register';
import { londonDate } from '@/domain/time';
import { submitOnboardingAction } from '../../../actions';
import { loadDogPage } from '../load';

export const metadata: Metadata = { title: 'Onboarding form' };
export const dynamic = 'force-dynamic';

const yn = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
];
const b = (v: boolean | null | undefined) => (v == null ? undefined : v ? 'yes' : 'no');

export default async function OnboardingPage({ params }: { params: Promise<{ dogId: string }> }) {
  const { dog, health: h, behaviour: be, permissions: p } = await loadDogPage((await params).dogId);
  const today = londonDate(new Date());
  const asked = new Set(consentsAsked(dog.dateOfBirth, today));
  return (
    <Card>
      <Stack>
        <p className={s.breadcrumb}>
          <Link href={`/account/dogs/${dog.id}`}>{dog.name}</Link> › Onboarding form
        </p>
        <h1>{dog.name}’s onboarding form</h1>
        <p>This helps us look after {dog.name} safely. Only Luna’s K9 Club can see these answers.</p>
        <ActionForm action={submitOnboardingAction}>
          <input type="hidden" name="dogId" value={dog.id} />
          <h2>Health</h2>
          <TextArea name="allergies" label="Allergies" defaultValue={h?.allergies} />
          <TextArea
            name="medication"
            label="Medication"
            hint="Name, dose and when it’s given"
            defaultValue={h?.medication}
          />
          <TextArea name="dietaryRequirements" label="Diet and feeding" defaultValue={h?.dietaryRequirements} />
          <TextArea name="medicalConditions" label="Medical conditions" defaultValue={h?.medicalConditions} />
          <TextArea
            name="fleaAndWorming"
            label="Flea and worming products you use"
            required
            defaultValue={h?.fleaAndWorming}
          />
          <TextField
            name="lastWormedOn"
            label="Date of the last worming treatment"
            type="date"
            required
            max={today}
            defaultValue={h?.lastWormedOn}
          />
          <TextField
            name="lastFleaTreatmentOn"
            label="Date of the last flea treatment"
            type="date"
            required
            max={today}
            defaultValue={h?.lastFleaTreatmentOn}
          />
          <RadioGroup
            name="exerciseRestricted"
            label="Does your dog have any exercise restrictions?"
            options={yn}
            defaultValue={b(h?.exerciseRestricted)}
          />
          <TextArea name="exerciseRestrictions" label="If yes, what are they?" defaultValue={h?.exerciseRestrictions} />
          <h2>Insurance</h2>
          <RadioGroup name="insured" label="Is your dog insured?" options={yn} defaultValue={b(h?.insured)} />
          <TextField name="insurer" label="If yes, who with?" defaultValue={h?.insurer} />
          <TextField name="insurancePolicyNumber" label="Policy number" defaultValue={h?.insurancePolicyNumber} />
          <h2>Behaviour</h2>
          <TextArea
            name="temperament"
            label="What is your dog like with people and other dogs?"
            required
            defaultValue={be?.temperament}
          />
          <TextArea name="triggers" label="Anything that worries or upsets your dog" defaultValue={be?.triggers} />
          <RadioGroup
            name="biteHistory"
            label="Has your dog ever bitten or shown aggression to a person or dog?"
            options={yn}
            defaultValue={b(be?.biteHistory)}
          />
          <TextArea name="biteDetails" label="If yes, what happened?" defaultValue={be?.biteDetails} />
          <TextArea
            name="handlingInstructions"
            label="Handling instructions"
            hint="For example, harness only, doesn’t like paws touched"
            defaultValue={be?.handlingInstructions}
          />
          <TextArea
            name="emergencyInstructions"
            label="Anything we should know in an emergency"
            defaultValue={be?.emergencyInstructions}
          />
          <h2>Permissions</h2>
          <RadioGroup
            name="transport"
            label="May we collect and drop off your dog in the Luna’s K9 Club dog taxi?"
            options={yn}
            defaultValue={b(p?.transport)}
          />
          <RadioGroup
            name="photosAndSocialMedia"
            label="May we share photos of your dog on social media?"
            options={yn}
            defaultValue={b(p?.photosAndSocialMedia)}
          />
          <RadioGroup
            name="emergencyVetTreatment"
            label="If we can’t reach you, may we arrange emergency vet treatment?"
            hint="We always try you and your emergency contacts first"
            options={yn}
            defaultValue={b(p?.emergencyVetTreatment)}
          />
          <h2>Consents</h2>
          <p className={s.hint}>Please answer each question. You can change your answers later.</p>
          {CONSENT_GROUPS.map((g) => {
            const questions = g.consents.filter((c) => asked.has(c.key));
            if (!questions.length) return null;
            return (
              <fieldset key={g.title} className={s.fieldset}>
                <legend className={s.label}>{g.title}</legend>
                <div className={s.stack}>
                  {questions.map((c) => (
                    <RadioGroup key={c.key} name={c.key} label={c.question} options={yn} defaultValue={b(p?.[c.key])} />
                  ))}
                </div>
              </fieldset>
            );
          })}
          <Checkbox
            name="confirmAccurate"
            label="I confirm this information is accurate and I’ll tell Luna’s K9 Club if anything changes"
          />
          <div>
            <SubmitButton pendingText="Sending…">Send onboarding form</SubmitButton>
          </div>
        </ActionForm>
      </Stack>
    </Card>
  );
}
