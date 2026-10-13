import { z } from 'zod';
import { checkbox, isoDate, optionalText, requiredText, ukPhone } from '../validation';
import { consentsAsked, CONSENTS, type ConsentKey } from '@/domain/compliance/register';
import type { IsoDate } from '@/domain/time';

/**
 * Zod schemas for the onboarding form and vet page, including the licence register fields
 * (D68–D70). Built per request because some rules depend on today's date and the dog's age.
 */

const yesNo = (msg: string) => z.enum(['yes', 'no'], { message: msg }).transform((v) => v === 'yes');

/** A past (or today's) date, not before the dog was born. */
const pastDate = (label: string, today: IsoDate, dateOfBirth: IsoDate | null) =>
  isoDate(label)
    .refine((v) => v <= today, 'This date is in the future')
    .refine((v) => !dateOfBirth || v >= dateOfBirth, 'This date is before your dog was born');

export type OnboardingContext = { today: IsoDate; dateOfBirth: IsoDate | null };

export function onboardingInput({ today, dateOfBirth }: OnboardingContext) {
  const asked = new Set(consentsAsked(dateOfBirth, today));
  const consentShape = {} as Record<ConsentKey, z.ZodType<boolean | undefined>>;
  for (const c of CONSENTS)
    consentShape[c.key] = asked.has(c.key)
      ? yesNo('Choose yes or no')
      : z
          .unknown()
          .optional()
          .transform(() => undefined);

  return z
    .object({
      allergies: optionalText(),
      medication: optionalText(),
      dietaryRequirements: optionalText(),
      medicalConditions: optionalText(),
      fleaAndWorming: requiredText('the flea and worming products you use', 500),
      lastWormedOn: pastDate('the date of the last worming treatment', today, dateOfBirth),
      lastFleaTreatmentOn: pastDate('the date of the last flea treatment', today, dateOfBirth),
      exerciseRestricted: yesNo('Tell us if your dog has any exercise restrictions'),
      exerciseRestrictions: optionalText(1000),
      insured: yesNo('Tell us if your dog is insured'),
      insurer: optionalText(120),
      insurancePolicyNumber: optionalText(60),
      temperament: requiredText('a short description of your dog’s temperament', 2000),
      triggers: optionalText(),
      biteHistory: yesNo('Tell us if your dog has ever bitten or shown aggression'),
      biteDetails: optionalText(),
      handlingInstructions: optionalText(),
      emergencyInstructions: optionalText(),
      transport: yesNo('Tell us if we may use the dog taxi'),
      photosAndSocialMedia: yesNo('Tell us if we may share photos'),
      emergencyVetTreatment: yesNo('Tell us if we may arrange emergency vet treatment'),
      ...consentShape,
      confirmAccurate: checkbox.refine((v) => v, 'Please confirm the information is accurate'),
    })
    .refine((d) => !d.biteHistory || Boolean(d.biteDetails), {
      message: 'Please tell us what happened',
      path: ['biteDetails'],
    })
    .refine((d) => !d.exerciseRestricted || Boolean(d.exerciseRestrictions), {
      message: 'Please tell us about the restrictions',
      path: ['exerciseRestrictions'],
    })
    .refine((d) => !d.insured || Boolean(d.insurer), {
      message: 'Enter the insurer’s name',
      path: ['insurer'],
    });
}

export type OnboardingData = z.infer<ReturnType<typeof onboardingInput>>;

export const VetInput = z
  .object({
    practiceName: requiredText('the practice name', 120),
    vetName: optionalText(120),
    phone: ukPhone,
    address: optionalText(300),
    agreedVet: z.enum(['same', 'other'], { message: 'Choose which vet we should use in an emergency' }),
    agreedPracticeName: optionalText(120),
    agreedPhone: z.string().trim().optional(),
    agreedAddress: optionalText(300),
  })
  .superRefine((d, ctx) => {
    if (d.agreedVet !== 'other') return;
    if (!d.agreedPracticeName)
      ctx.addIssue({ code: 'custom', path: ['agreedPracticeName'], message: 'Enter the practice name' });
    if (!ukPhone.safeParse(d.agreedPhone ?? '').success)
      ctx.addIssue({
        code: 'custom',
        path: ['agreedPhone'],
        message: 'Enter a UK phone number, like 01483 000000',
      });
  })
  .transform((d) => ({
    vet: { practiceName: d.practiceName, vetName: d.vetName, phone: d.phone, address: d.address },
    agreed:
      d.agreedVet === 'same'
        ? ({ kind: 'same' } as const)
        : ({
            kind: 'other',
            practiceName: d.agreedPracticeName!,
            phone: ukPhone.parse(d.agreedPhone),
            address: d.agreedAddress,
          } as const),
  }));
