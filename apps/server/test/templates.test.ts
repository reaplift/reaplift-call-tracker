import { describe, expect, it } from 'vitest';
import { blankLabel, fillTemplate, invalidBlanks, templateBlanks } from '@reaplift/calls-shared';

// M10: the blank rules the panel preview, the server and the app share.
const FOLLOW_UP = "Hi {{name}}, this is {{employee_name}} from {{company_name}}. I'll call you on {{follow_up_date}} about {{site_name}}.";

describe('WhatsApp template blanks', () => {
  it('lists each blank once, in order', () => {
    expect(templateBlanks(FOLLOW_UP + ' Thanks {{name}}!')).toEqual(['name', 'employee_name', 'company_name', 'follow_up_date', 'site_name']);
    expect(templateBlanks('No blanks here.')).toEqual([]);
    expect(templateBlanks('Spaces {{ name }} are fine')).toEqual(['name']);
  });

  it('names blanks for the screen', () => {
    expect(blankLabel('name')).toBe("Client's name");
    expect(blankLabel('site_name')).toBe('Site name');
  });

  it('finds blank names that break the rule', () => {
    expect(invalidBlanks('Hi {{Client Name}} and {{price}} and {{}}')).toEqual(['Client Name', '']);
  });

  it('fills what it has and leaves gaps visible', () => {
    expect(fillTemplate(FOLLOW_UP, { name: 'Asha', employee_name: 'Meena Iyer', company_name: 'Country Roads', follow_up_date: '13 Nov', site_name: ' ' })).toBe(
      "Hi Asha, this is Meena Iyer from Country Roads. I'll call you on 13 Nov about {{site_name}}.",
    );
    expect(fillTemplate('नमस्ते {{name}} 🙏', { name: 'आशा' })).toBe('नमस्ते आशा 🙏');
  });
});
